import fontkit from "@pdf-lib/fontkit";
import regeneratorRuntime from "regenerator-runtime";
import { StandardFonts, type Color, type PDFDocument, type PDFFont, type PDFPage } from "pdf-lib";
import { scriptFont, scriptForCodePoint, type PdfScript } from "./font-catalog.ts";

// Unicode-safe PDF text (PDF-01, PDF-06). Text stays in Helvetica where WinAnsi can encode it;
// Indian scripts, the rupee sign and accented Latin names switch to embedded Noto Sans subsets
// instead of being stripped. fontkit's Indic shaper needs a regenerator runtime global.
const globalScope = globalThis as typeof globalThis & { regeneratorRuntime?: unknown };
globalScope.regeneratorRuntime ??= regeneratorRuntime;

export type PdfFontLoader = (file: string) => Promise<Uint8Array>;
type FontKey = "base" | PdfScript;
type Run = { font: PdfFont; text: string };
type PdfFont = { pdf: PDFFont; chars: Set<number> };

const JOINERS = new Set([0x200c, 0x200d]);
const REPLACEMENT = "?";

function codePoints(text: string) {
  return Array.from(text.replace(/\t/g, " ").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ""));
}

export class PdfTextKit {
  readonly missing = new Set<string>();
  private readonly fonts = new Map<string, PdfFont>();
  private readonly pdf: PDFDocument;
  private readonly loadFont: PdfFontLoader;

  private constructor(pdf: PDFDocument, loadFont: PdfFontLoader) {
    this.pdf = pdf;
    this.loadFont = loadFont;
  }

  static async create(pdf: PDFDocument, loadFont: PdfFontLoader, texts: Iterable<unknown> = []) {
    pdf.registerFontkit(fontkit);
    const kit = new PdfTextKit(pdf, loadFont);
    for (const [key, name] of [["base:regular", StandardFonts.Helvetica], ["base:bold", StandardFonts.HelveticaBold]] as const) {
      const font = await pdf.embedFont(name);
      kit.fonts.set(key, { pdf: font, chars: new Set(font.getCharacterSet()) });
    }
    await kit.ensure(texts);
    return kit;
  }

  /** Embeds every script font the given texts need. Drawing itself is synchronous. */
  async ensure(texts: Iterable<unknown>) {
    const needed = new Set<PdfScript>();
    for (const value of texts) {
      for (const char of codePoints(String(value ?? ""))) {
        const codePoint = char.codePointAt(0)!;
        if (this.fonts.get("base:regular")!.chars.has(codePoint)) continue;
        const script = scriptForCodePoint(codePoint);
        if (script) needed.add(script);
      }
    }
    for (const script of needed) {
      if (this.fonts.has(`${script}:regular`)) continue;
      const files = scriptFont(script);
      for (const [weight, file] of [["regular", files.regular], ["bold", files.bold]] as const) {
        const font = await this.pdf.embedFont(await this.loadFont(file), { subset: true });
        this.fonts.set(`${script}:${weight}`, { pdf: font, chars: new Set(font.getCharacterSet()) });
      }
    }
  }

  private font(key: FontKey, bold: boolean) {
    return this.fonts.get(`${key}:${bold ? "bold" : "regular"}`) ?? null;
  }

  /** Splits text into runs that one embedded font can encode. */
  runs(text: string, bold = false): Run[] {
    const base = this.font("base", bold)!;
    const runs: Run[] = [];
    const push = (font: PdfFont, char: string) => {
      const last = runs[runs.length - 1];
      if (last && last.font === font) last.text += char;
      else runs.push({ font, text: char });
    };
    for (const char of codePoints(text)) {
      const codePoint = char.codePointAt(0)!;
      const last = runs[runs.length - 1];
      if (JOINERS.has(codePoint) && last && last.font !== base) { last.text += char; continue; }
      if (base.chars.has(codePoint)) { push(base, char); continue; }
      const script = scriptForCodePoint(codePoint);
      const scriptFace = script ? this.font(script, bold) : null;
      if (scriptFace && scriptFace.chars.has(codePoint)) { push(scriptFace, char); continue; }
      this.missing.add(char);
      push(base, REPLACEMENT);
    }
    return runs;
  }

  measure(text: string, size: number, bold = false) {
    return this.runs(text, bold).reduce((width, run) => width + run.font.pdf.widthOfTextAtSize(run.text, size), 0);
  }

  draw(page: PDFPage, text: string, options: { x: number; y: number; size: number; bold?: boolean; color?: Color }) {
    let x = options.x;
    for (const run of this.runs(text, options.bold)) {
      page.drawText(run.text, { x, y: options.y, size: options.size, font: run.font.pdf, color: options.color });
      x += run.font.pdf.widthOfTextAtSize(run.text, options.size);
    }
    return x - options.x;
  }

  drawRight(page: PDFPage, text: string, options: { right: number; y: number; size: number; bold?: boolean; color?: Color }) {
    const width = this.measure(text, options.size, options.bold);
    return this.draw(page, text, { ...options, x: options.right - width });
  }

  /**
   * Word-wraps to a width. Tokens wider than the line (long profile codes, references,
   * e-way bill numbers) are hard-broken at grapheme boundaries so nothing overflows (PDF-03).
   */
  wrap(text: string, size: number, maxWidth: number, bold = false): string[] {
    const lines: string[] = [];
    for (const paragraph of String(text ?? "").split(/\r?\n/)) {
      let line = "";
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        const candidate = line ? `${line} ${word}` : word;
        if (this.measure(candidate, size, bold) <= maxWidth) { line = candidate; continue; }
        if (line) lines.push(line);
        if (this.measure(word, size, bold) <= maxWidth) { line = word; continue; }
        line = "";
        for (const grapheme of graphemes(word)) {
          if (line && this.measure(line + grapheme, size, bold) > maxWidth) { lines.push(line); line = grapheme; }
          else line += grapheme;
        }
      }
      lines.push(line);
    }
    return lines;
  }
}

function graphemes(text: string): string[] {
  const Segmenter = (Intl as typeof Intl & { Segmenter?: new (locale?: string, options?: { granularity: "grapheme" }) => { segment(input: string): Iterable<{ segment: string }> } }).Segmenter;
  if (Segmenter) return Array.from(new Segmenter(undefined, { granularity: "grapheme" }).segment(text), (part) => part.segment);
  return Array.from(text);
}

export function browserFontLoader(basePath = "/fonts/pdf"): PdfFontLoader {
  return async (file) => {
    const response = await fetch(`${basePath}/${file}`);
    if (!response.ok) throw new Error(`PDF font ${file} is unavailable (${response.status}).`);
    return new Uint8Array(await response.arrayBuffer());
  };
}
