import { PDFDocument, rgb, type Color, type PDFImage, type PDFPage } from "pdf-lib";
import { PdfTextKit, type PdfFontLoader } from "./unicode-text.ts";
import { PDF_BLANK, pdfDateTime } from "./format.ts";

// Shared layout engine for every printed ExtrusionOS document (quotes, tax invoices, vouchers,
// technical sheets, configurator outputs and report exports). One grid, one type scale and one
// set of rules so documents read the same way: identity header, ruled tables whose header
// repeats on every page, right-aligned figures, and a footer with document number and
// "Page x of y" on every page. All text goes through PdfTextKit, so Indian scripts and the
// rupee sign render with embedded fonts and long tokens wrap instead of overflowing.

export const PDF_PAGE = {
  portrait: [595.28, 841.89] as [number, number],
  landscape: [841.89, 595.28] as [number, number]
};

export const PDF_COLORS = {
  ink: rgb(0.08, 0.09, 0.11),
  body: rgb(0.17, 0.19, 0.22),
  muted: rgb(0.42, 0.45, 0.49),
  rule: rgb(0.66, 0.69, 0.72),
  hairline: rgb(0.85, 0.87, 0.89),
  fill: rgb(0.945, 0.95, 0.957),
  groupFill: rgb(0.975, 0.977, 0.98),
  white: rgb(1, 1, 1),
  void: rgb(0.66, 0.12, 0.12),
  warning: rgb(0.62, 0.38, 0.02),
  positive: rgb(0.1, 0.42, 0.22)
};

const MARGIN_X = 40;
const MARGIN_TOP = 40;
const CONTENT_BOTTOM = 54;
const FOOTER_RULE_Y = 40;
const FOOTER_TEXT_Y = 29;
const HEADING_HEIGHT = 14;

export type Align = "left" | "right" | "center";
export type StampTone = "void" | "warning" | "neutral" | "positive";

export type DocumentIdentity = {
  /** Printed title, e.g. "TAX INVOICE". */
  title: string;
  /** Document number repeated in the running header and footer. */
  number?: string | null;
  issuer: { name: string; lines?: (string | null | undefined | false)[] };
  /** Company logo (PNG or JPEG bytes, see lib/pdf/logo.ts); printed above the issuer block. */
  logo?: Uint8Array | null;
  /** Right-hand header facts: [label, value]. Empty values are skipped. */
  meta?: [string, string | null | undefined][];
  stamp?: { text: string; tone?: StampTone } | null;
  footerNote?: string;
  orientation?: "portrait" | "landscape";
  generatedAt?: Date;
  /** PDF metadata */
  subject?: string;
  author?: string;
};

/** `wrap` defaults to false for right-aligned (numeric) columns: figures shrink to fit, never break. */
export type PdfTableColumn = { header: string; width: number; align?: Align; wrap?: boolean };
export type PdfCell = string | number | null | undefined;
export type PdfTableRow = PdfCell[] | { cells: PdfCell[]; kind?: "body" | "group" | "total" | "subtotal" };
export type PdfTableOptions = {
  size?: number; headerSize?: number; emptyText?: string; blank?: string;
  /** Points of following content (e.g. signatures) kept on the same page as the table's last row. */
  keepWithNext?: number;
};
export type PdfField = [string, PdfCell | boolean];
export type PdfTotalRow = { label: string; value: string; emphasis?: boolean; muted?: boolean };

/** Recursively gathers every string so the needed script fonts are embedded up front. */
export function collectStrings(value: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 8 || value === null || value === undefined) return out;
  if (typeof value === "string") out.push(value);
  else if (typeof value === "number") out.push(String(value));
  else if (Array.isArray(value)) value.forEach((entry) => collectStrings(entry, out, depth + 1));
  else if (typeof value === "object" && !(value instanceof Date) && !(value instanceof Uint8Array)) {
    Object.values(value as Record<string, unknown>).forEach((entry) => collectStrings(entry, out, depth + 1));
  }
  return out;
}

function clean(value: unknown) {
  return String(value ?? "")
    .replace(/[​﻿⁠]/g, "")
    .replace(/[   ]/g, " ")
    .replace(/\r\n?/g, "\n");
}

/** Embeds a PNG/JPEG logo; an unreadable image is left out rather than failing the document. */
async function embedLogo(pdf: PDFDocument, bytes: Uint8Array | null | undefined): Promise<PDFImage | null> {
  if (!bytes || bytes.length < 8) return null;
  try {
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return await pdf.embedPng(bytes);
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return await pdf.embedJpg(bytes);
  } catch {
    return null;
  }
  return null;
}

/** Scales an image to fit a box, keeping its aspect ratio. */
function fitImage(image: PDFImage, maxWidth: number, maxHeight: number) {
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
  return { width: image.width * scale, height: image.height * scale };
}

function cellText(value: PdfCell | boolean, blank: string) {
  if (value === null || value === undefined) return blank;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const text = clean(value).trim();
  return text ? text : blank;
}

export class PdfDocumentWriter {
  readonly pdf: PDFDocument;
  readonly kit: PdfTextKit;
  readonly identity: DocumentIdentity;
  readonly width: number;
  readonly height: number;
  readonly left = MARGIN_X;
  readonly right: number;
  readonly contentWidth: number;
  readonly bottom = CONTENT_BOTTOM;
  page!: PDFPage;
  y = 0;
  private logo: PDFImage | null = null;
  private continuationTop = 0;

  private constructor(pdf: PDFDocument, kit: PdfTextKit, identity: DocumentIdentity) {
    this.pdf = pdf;
    this.kit = kit;
    this.identity = identity;
    [this.width, this.height] = PDF_PAGE[identity.orientation ?? "portrait"];
    this.right = this.width - MARGIN_X;
    this.contentWidth = this.right - this.left;
  }

  /** `content` is any data that may be printed; its strings decide which fonts to embed. */
  static async create(identity: DocumentIdentity, loadFont: PdfFontLoader, content: unknown = []) {
    const pdf = await PDFDocument.create();
    const kit = await PdfTextKit.create(pdf, loadFont, collectStrings([identity, content]).map(clean));
    const writer = new PdfDocumentWriter(pdf, kit, identity);
    writer.logo = await embedLogo(pdf, identity.logo);
    writer.page = pdf.addPage(PDF_PAGE[identity.orientation ?? "portrait"]);
    writer.continuationTop = writer.height - MARGIN_TOP - 26;
    writer.drawFirstHeader();
    return writer;
  }

  // ---------------------------------------------------------------------------
  // Primitives
  // ---------------------------------------------------------------------------

  measure(text: string, size: number, bold = false) {
    return this.kit.measure(clean(text), size, bold);
  }

  wrap(text: unknown, size: number, width: number, bold = false) {
    return this.kit.wrap(clean(text), size, Math.max(4, width), bold);
  }

  text(text: unknown, x: number, baseline: number, options: { size?: number; bold?: boolean; color?: Color; align?: Align; page?: PDFPage } = {}) {
    const size = options.size ?? 8.5;
    const value = clean(text);
    const width = this.kit.measure(value, size, options.bold);
    const drawX = options.align === "right" ? x - width : options.align === "center" ? x - width / 2 : x;
    this.kit.draw(options.page ?? this.page, value, { x: drawX, y: baseline, size, bold: options.bold, color: options.color ?? PDF_COLORS.body });
    return width;
  }

  rule(y: number, options: { from?: number; to?: number; thickness?: number; color?: Color } = {}) {
    this.page.drawLine({
      start: { x: options.from ?? this.left, y }, end: { x: options.to ?? this.right, y },
      thickness: options.thickness ?? 0.5, color: options.color ?? PDF_COLORS.hairline
    });
  }

  rect(x: number, y: number, width: number, height: number, options: { fill?: Color; border?: Color; borderWidth?: number } = {}) {
    this.page.drawRectangle({
      x, y, width, height, color: options.fill,
      borderColor: options.border, borderWidth: options.border ? options.borderWidth ?? 0.6 : undefined
    });
  }

  space(height: number) {
    this.y -= height;
  }

  /**
   * Starts a new page when `height` does not fit. Returns true when a page was added. A section
   * heading waiting to be drawn is placed here, so it always lands on the same page as the first
   * content of its section.
   */
  ensure(height: number, onBreak?: () => void) {
    const broke = this.y - height - this.headingHeight() < this.bottom;
    if (broke) this.addPage();
    this.flushHeading();
    if (broke) onBreak?.();
    return broke;
  }

  /** Heading text held by sectionTitle() until the next block is placed. */
  private pendingHeading: string | null = null;

  private headingHeight() {
    return this.pendingHeading === null ? 0 : HEADING_HEIGHT;
  }

  private flushHeading() {
    if (this.pendingHeading === null) return;
    this.text(this.pendingHeading, this.left, this.y - 8, { size: 8, bold: true, color: PDF_COLORS.ink });
    this.y -= HEADING_HEIGHT;
    this.pendingHeading = null;
  }

  /** Room kept after each closing block's final line for the signature row (see closing()). */
  private closingReserve = 0;

  /**
   * Marks the start of a document's closing section (totals, amount in words, notes, terms, final
   * list). From here on a heading, and each block's final line or row, is placed only where the
   * signature row still fits after it, so signatures never stand alone on a page.
   */
  closing(labels: string[], options: { forName?: string } = {}) {
    // Signatures may shrink by 10 pt (see signatures()); builders leave at most 18 pt between the
    // final block and the signature row, so height - 10 + 18 is always enough.
    this.closingReserve = this.signatureHeight(labels, options) + 8;
  }

  /** ensure() for the final unit of a block: in the closing section it also keeps the signatures' room. */
  private ensureLast(height: number) {
    const reserve = this.closingReserve;
    const needed = height + this.headingHeight();
    if (reserve && this.y - needed >= this.bottom && this.y - needed - reserve < this.bottom && needed + reserve <= this.continuationTop - this.bottom) {
      this.addPage();
      this.flushHeading();
      return true;
    }
    return this.ensure(height);
  }

  addPage() {
    this.page = this.pdf.addPage([this.width, this.height]);
    this.drawContinuationHeader();
  }

  get pageCount() {
    return this.pdf.getPageCount();
  }

  // ---------------------------------------------------------------------------
  // Page furniture
  // ---------------------------------------------------------------------------

  private drawFirstHeader() {
    const { identity } = this;
    const top = this.height - MARGIN_TOP;
    const rightWidth = Math.min(225, this.contentWidth * 0.42);
    const rightX = this.right - rightWidth;
    const leftWidth = rightX - this.left - 18;

    // Issuer identity, left: logo (when the company has one), then name, address and GSTIN.
    let leftY = top;
    if (this.logo) {
      const size = fitImage(this.logo, Math.min(leftWidth, 170), 36);
      this.page.drawImage(this.logo, { x: this.left, y: top - size.height, width: size.width, height: size.height });
      leftY = top - size.height - 9;
    }
    // The issuer name steps down to 11 pt to stay on one line before it wraps.
    let nameSize = 13;
    while (nameSize > 11 && this.measure(identity.issuer.name, nameSize, true) > leftWidth) nameSize -= 0.5;
    for (const line of this.wrap(identity.issuer.name, nameSize, leftWidth, true)) {
      this.text(line, this.left, leftY - nameSize * 0.85, { size: nameSize, bold: true, color: PDF_COLORS.ink });
      leftY -= nameSize * 1.25;
    }
    leftY -= 2;
    for (const raw of identity.issuer.lines ?? []) {
      if (!raw) continue;
      for (const line of this.wrap(raw, 8, leftWidth)) {
        this.text(line, this.left, leftY - 7.5, { size: 8, color: PDF_COLORS.body });
        leftY -= 11;
      }
    }

    // Document title, stamp and facts, right.
    let rightY = top;
    for (const line of this.wrap(identity.title, 15, rightWidth, true)) {
      this.text(line, this.right, rightY - 12.5, { size: 15, bold: true, color: PDF_COLORS.ink, align: "right" });
      rightY -= 18;
    }
    if (identity.stamp?.text) {
      const tone = identity.stamp.tone ?? "neutral";
      const color = tone === "void" ? PDF_COLORS.void : tone === "warning" ? PDF_COLORS.warning : tone === "positive" ? PDF_COLORS.positive : PDF_COLORS.ink;
      const label = clean(identity.stamp.text).toUpperCase();
      const width = this.measure(label, 8, true) + 12;
      rightY -= 2;
      this.rect(this.right - width, rightY - 14, width, 14, { border: color, borderWidth: 0.9 });
      this.text(label, this.right - width / 2, rightY - 10, { size: 8, bold: true, color, align: "center" });
      rightY -= 20;
    }
    const meta = (identity.meta ?? []).filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "");
    if (meta.length) {
      rightY -= 3;
      const labelWidth = Math.min(rightWidth * 0.46, Math.max(...meta.map(([label]) => this.measure(label, 7.5))) + 10);
      for (const [label, value] of meta) {
        const lines = this.wrap(value, 8, rightWidth - labelWidth);
        this.text(label, rightX, rightY - 7.5, { size: 7.5, color: PDF_COLORS.muted });
        for (const line of lines) {
          this.text(line, this.right, rightY - 7.5, { size: 8, bold: true, color: PDF_COLORS.ink, align: "right" });
          rightY -= 11;
        }
        rightY -= 1;
      }
    }

    const ruleY = Math.min(leftY, rightY) - 8;
    this.rule(ruleY, { thickness: 1.2, color: PDF_COLORS.ink });
    this.y = ruleY - 14;
  }

  private drawContinuationHeader() {
    const top = this.height - MARGIN_TOP;
    const { identity } = this;
    const reference = [identity.title, identity.number].filter(Boolean).join(" ");
    const rightText = `${reference} (continued)`;
    const rightWidth = this.measure(rightText, 8);
    let nameX = this.left;
    if (this.logo) {
      const size = fitImage(this.logo, 70, 11);
      this.page.drawImage(this.logo, { x: this.left, y: top - 10, width: size.width, height: size.height });
      nameX += size.width + 8;
    }
    const name = this.wrap(identity.issuer.name, 8.5, this.right - rightWidth - 20 - nameX, true)[0] ?? "";
    this.text(name, nameX, top - 8, { size: 8.5, bold: true, color: PDF_COLORS.ink });
    this.text(rightText, this.right, top - 8, { size: 8, color: PDF_COLORS.muted, align: "right" });
    this.rule(top - 14, { thickness: 0.8, color: PDF_COLORS.ink });
    this.y = top - 26;
    this.continuationTop = this.y;
  }

  private drawFooters() {
    const pages = this.pdf.getPages();
    const generated = `Generated ${pdfDateTime(this.identity.generatedAt ?? new Date())}`;
    const note = this.identity.footerNote ?? "This is a computer-generated document.";
    let lastLineY = FOOTER_TEXT_Y;
    pages.forEach((page, index) => {
      page.drawLine({ start: { x: this.left, y: FOOTER_RULE_Y }, end: { x: this.right, y: FOOTER_RULE_Y }, thickness: 0.5, color: PDF_COLORS.rule });
      const right = `${this.identity.number ? `${clean(this.identity.number)}   ·   ` : ""}Page ${index + 1} of ${pages.length}`;
      const rightWidth = this.measure(right, 7);
      // A long note takes a second line rather than being cut off; the timestamp is never dropped.
      const leftWidth = this.contentWidth - rightWidth - 24;
      const single = `${note}  ${generated}`;
      const lines = this.measure(single, 7) <= leftWidth ? [single] : [...this.wrap(note, 7, leftWidth).slice(0, 2), generated];
      lines.forEach((line, lineIndex) => this.text(line, this.left, FOOTER_TEXT_Y - lineIndex * 9, { size: 7, color: PDF_COLORS.muted, page }));
      lastLineY = Math.min(lastLineY, FOOTER_TEXT_Y - (lines.length - 1) * 9);
      this.text(right, this.right, FOOTER_TEXT_Y, { size: 7, color: PDF_COLORS.muted, align: "right", page });
    });
    if (this.kit.missing.size) {
      this.text(`${this.kit.missing.size} character(s) outside the supported scripts are printed as "?".`, this.left, lastLineY - 9,
        { size: 6.5, color: PDF_COLORS.muted, page: pages[pages.length - 1] });
    }
  }

  async finish() {
    this.drawFooters();
    const { identity } = this;
    this.pdf.setTitle(clean([identity.title, identity.number].filter(Boolean).join(" ")), { showInWindowTitleBar: true });
    this.pdf.setAuthor(clean(identity.author ?? identity.issuer.name));
    if (identity.subject) this.pdf.setSubject(clean(identity.subject));
    this.pdf.setCreator("ExtrusionOS");
    this.pdf.setProducer("ExtrusionOS document engine");
    this.pdf.setCreationDate(identity.generatedAt ?? new Date());
    return this.pdf.save();
  }

  // ---------------------------------------------------------------------------
  // Blocks
  // ---------------------------------------------------------------------------

  /** Small caps-style section heading kept with at least `keepWithNext` points of content. */
  sectionTitle(title: string, keepWithNext = 48, options: { uppercase?: boolean } = {}) {
    this.ensure(20 + keepWithNext);
    const text = options.uppercase === false ? clean(title) : clean(title).toUpperCase();
    // Drawn by the next block's ensure(), on whichever page that block starts.
    this.pendingHeading = this.wrap(text, 8, this.contentWidth, true)[0] ?? "";
  }

  paragraph(text: unknown, options: { size?: number; bold?: boolean; color?: Color; indent?: number; width?: number; lineHeight?: number; align?: Align } = {}) {
    const size = options.size ?? 8.5;
    const lineHeight = options.lineHeight ?? Math.round(size * 1.42 * 10) / 10;
    const indent = options.indent ?? 0;
    const width = options.width ?? this.contentWidth - indent;
    const lines = this.wrap(text, size, width, options.bold);
    lines.forEach((line, index) => {
      if (index === lines.length - 1) this.ensureLast(lineHeight); else this.ensure(lineHeight);
      const x = options.align === "right" ? this.left + indent + width : this.left + indent;
      if (line) this.text(line, x, this.y - size, { size, bold: options.bold, color: options.color ?? PDF_COLORS.body, align: options.align });
      this.y -= lineHeight;
    });
  }

  /** Terms and notes. Lines that start with "1.", "a)", "-" or "•" get a hanging indent. */
  list(lines: string[], options: { size?: number; color?: Color } = {}) {
    const size = options.size ?? 8;
    const lineHeight = Math.round(size * 1.45 * 10) / 10;
    const items = lines.map((line) => clean(line).trim()).filter(Boolean);
    items.forEach((raw, itemIndex) => {
      const marker = /^((?:\d{1,2}|[a-z]|[ivx]{1,4})[.)]|[-•*–])\s+(.*)$/i.exec(raw);
      const label = marker ? (/^[-•*–]$/.test(marker[1]) ? "•" : marker[1]) : "";
      const body = marker ? marker[2] : raw;
      const indent = label ? 16 : 0;
      const wrapped = this.wrap(body, size, this.contentWidth - indent);
      wrapped.forEach((line, index) => {
        if (itemIndex === items.length - 1 && index === wrapped.length - 1) this.ensureLast(lineHeight); else this.ensure(lineHeight);
        if (index === 0 && label) this.text(label, this.left, this.y - size, { size, color: options.color ?? PDF_COLORS.body });
        this.text(line, this.left + indent, this.y - size, { size, color: options.color ?? PDF_COLORS.body });
        this.y -= lineHeight;
      });
      this.y -= 1.5;
    });
  }

  /** Bordered address/identity panels laid side by side (Bill to / Ship to, bank details). */
  panels(blocks: { label: string; title?: string | null; lines?: (string | null | undefined | false)[] }[], options: { gap?: number } = {}) {
    if (!blocks.length) return;
    const gap = options.gap ?? 12;
    const width = (this.contentWidth - gap * (blocks.length - 1)) / blocks.length;
    const pad = 8;
    const inner = width - pad * 2;
    const laid = blocks.map((block) => ({
      label: clean(block.label).toUpperCase(),
      title: block.title ? this.wrap(block.title, 9, inner, true) : [],
      lines: (block.lines ?? []).filter((line): line is string => Boolean(line && String(line).trim())).flatMap((line) => this.wrap(line, 8, inner))
    }));
    const height = Math.max(...laid.map((block) => pad + 11 + block.title.length * 12.5 + block.lines.length * 11 + pad - 2), 44);
    this.ensureLast(height + 4);
    const top = this.y;
    laid.forEach((block, index) => {
      const x = this.left + index * (width + gap);
      this.rect(x, top - height, width, height, { border: PDF_COLORS.rule, borderWidth: 0.6 });
      let y = top - pad;
      this.text(block.label, x + pad, y - 6.5, { size: 6.8, bold: true, color: PDF_COLORS.muted });
      y -= 11;
      for (const line of block.title) {
        this.text(line, x + pad, y - 8.5, { size: 9, bold: true, color: PDF_COLORS.ink });
        y -= 12.5;
      }
      for (const line of block.lines) {
        this.text(line, x + pad, y - 7.5, { size: 8, color: PDF_COLORS.body });
        y -= 11;
      }
    });
    this.y = top - height - 12;
  }

  /** Label/value grid (spec-sheet style) with hairline row rules; values wrap. */
  fields(fields: PdfField[], options: { columns?: number; labelRatio?: number; blank?: string } = {}) {
    const items = fields.filter(([label]) => Boolean(label));
    if (!items.length) return;
    const columns = Math.max(1, options.columns ?? 2);
    const gap = 18;
    const columnWidth = (this.contentWidth - gap * (columns - 1)) / columns;
    const labelWidth = columnWidth * (options.labelRatio ?? 0.42);
    const valueWidth = columnWidth - labelWidth - 6;
    const lineHeight = 11;
    const padV = 4;
    const blank = options.blank ?? PDF_BLANK;
    let first = true;
    for (let index = 0; index < items.length; index += columns) {
      const row = items.slice(index, index + columns).map(([label, value]) => ({
        label: this.wrap(label, 7.5, labelWidth - 4),
        value: this.wrap(cellText(value, blank), 8.5, valueWidth)
      }));
      const lines = Math.max(...row.map((cell) => Math.max(cell.label.length, cell.value.length)));
      const height = lines * lineHeight + padV * 2;
      const lastRow = index + columns >= items.length;
      if ((lastRow ? this.ensureLast(height) : this.ensure(height)) || first) {
        this.rule(this.y, { color: PDF_COLORS.rule, thickness: 0.6 });
        first = false;
      }
      row.forEach((cell, column) => {
        const x = this.left + column * (columnWidth + gap);
        cell.label.forEach((line, lineIndex) => this.text(line, x, this.y - padV - 8 - lineIndex * lineHeight, { size: 7.5, color: PDF_COLORS.muted }));
        cell.value.forEach((line, lineIndex) => this.text(line, x + labelWidth, this.y - padV - 8 - lineIndex * lineHeight, { size: 8.5, color: PDF_COLORS.ink }));
      });
      this.y -= height;
      this.rule(this.y);
    }
    this.y -= 12;
  }

  /**
   * Ruled table. Column widths are relative weights scaled to the content width. The header
   * repeats after every page break, rows never overflow their cell, and a row taller than a
   * page is split across pages instead of being clipped.
   */
  table(columns: PdfTableColumn[], rows: PdfTableRow[], options: PdfTableOptions = {}) {
    const size = options.size ?? 8;
    const headerSize = options.headerSize ?? 7.3;
    const blank = options.blank ?? PDF_BLANK;
    const padX = 4;
    const padV = 3.6;
    const lineHeight = Math.round(size * 1.3 * 10) / 10;
    const headerLineHeight = Math.round(headerSize * 1.25 * 10) / 10;
    const totalWeight = columns.reduce((sum, column) => sum + column.width, 0) || 1;
    const widths = columns.map((column) => (column.width / totalWeight) * this.contentWidth);
    const xs = widths.map((_, index) => this.left + widths.slice(0, index).reduce((sum, width) => sum + width, 0));
    // A text column that follows a figure column gets extra lead so the two never touch.
    const lead = columns.map((column, index) => ((column.align ?? "left") === "left" && index > 0 && columns[index - 1].align === "right" ? 7 : 0));
    const inner = widths.map((width, index) => width - padX * 2 - lead[index]);
    // Words are not split mid-word while a slightly smaller size (down to 85%) still fits them;
    // only longer tokens (codes, references) are hard-broken.
    const wordFit = (text: string, index: number, bold: boolean, base: number) => {
      const words = text.split(/\s+/).filter(Boolean);
      let fitted = base;
      while (fitted > Math.max(5.5, base * 0.85) && words.some((word) => this.measure(word, fitted, bold) > inner[index])) fitted -= 0.25;
      return fitted;
    };
    const headerSizes = columns.map((column, index) => wordFit(clean(column.header), index, true, headerSize));
    const headerLines = columns.map((column, index) => this.wrap(column.header, headerSizes[index], inner[index], true));
    const headerHeight = Math.max(...headerLines.map((lines) => lines.length)) * headerLineHeight + padV * 2 + 1;

    const wraps = columns.map((column) => column.wrap ?? (column.align ?? "left") !== "right");
    const fitSize = (text: string, index: number, bold: boolean) => {
      let fitted = size;
      while (fitted > 5.5 && this.measure(text, fitted, bold) > inner[index]) fitted -= 0.25;
      return fitted;
    };
    const cellX = (index: number) => {
      const align = columns[index].align ?? "left";
      return align === "right" ? xs[index] + widths[index] - padX : align === "center" ? xs[index] + (widths[index] + lead[index]) / 2 : xs[index] + padX + lead[index];
    };
    const drawHeader = () => {
      const top = this.y;
      this.rect(this.left, top - headerHeight, this.contentWidth, headerHeight, { fill: PDF_COLORS.fill });
      this.rule(top, { thickness: 0.9, color: PDF_COLORS.ink });
      headerLines.forEach((lines, index) => lines.forEach((line, lineIndex) => {
        this.text(line, cellX(index), top - padV - headerSize * 0.92 - lineIndex * headerLineHeight,
          { size: headerSizes[index], bold: true, color: PDF_COLORS.ink, align: columns[index].align ?? "left" });
      }));
      this.y = top - headerHeight;
      this.rule(this.y, { thickness: 0.6, color: PDF_COLORS.rule });
    };

    const normalized = rows.map((row) => (Array.isArray(row) ? { cells: row, kind: "body" as const } : { cells: row.cells, kind: row.kind ?? "body" }));
    /** Lines per cell plus the font size of each wrapped cell. */
    const layout = (row: (typeof normalized)[number]) => {
      if (row.kind === "group") return { cells: [this.wrap(cellText(row.cells[0], blank), size, this.contentWidth - padX * 2, true)], sizes: [size] };
      const bold = row.kind === "total" || row.kind === "subtotal";
      const sizes: number[] = [];
      const cells = columns.map((_, index) => {
        sizes.push(size);
        const value = row.cells[index];
        if (value === "" && bold) return [""];
        const text = cellText(value, bold && (value === null || value === undefined) ? "" : blank);
        if (!wraps[index]) return [text.replace(/\s*\n\s*/g, " ")];
        sizes[index] = wordFit(text, index, bold, size);
        return this.wrap(text, sizes[index], inner[index], bold);
      });
      return { cells, sizes };
    };

    const firstHeight = normalized.length ? Math.max(...layout(normalized[0]).cells.map((lines) => lines.length)) * lineHeight + padV * 2 : lineHeight + padV * 2;
    const keep = Math.max(options.keepWithNext ?? 0, this.closingReserve);
    // An empty or one-row table is kept whole with the following block from the start.
    this.ensure(headerHeight + firstHeight + (normalized.length <= 1 ? keep : 0));
    drawHeader();

    if (!normalized.length) {
      this.text(options.emptyText ?? "No records.", this.left + padX, this.y - padV - size, { size, color: PDF_COLORS.muted });
      this.y -= lineHeight + padV * 2;
      this.rule(this.y, { thickness: 0.9, color: PDF_COLORS.ink });
      this.y -= 12;
      return;
    }

    // Trailing total/subtotal rows are kept on the same page as the last body row above them.
    let tailStart = normalized.length;
    while (tailStart > 0 && (normalized[tailStart - 1].kind === "total" || normalized[tailStart - 1].kind === "subtotal")) tailStart -= 1;
    const tailHeight = normalized.slice(tailStart).reduce((sum, row) => sum + Math.max(1, ...layout(row).cells.map((cell) => cell.length)) * lineHeight + padV * 2, 0);

    normalized.forEach((row, rowIndex) => {
      const laid = layout(row);
      let remaining = laid.cells;
      const bold = row.kind === "total" || row.kind === "subtotal";
      for (;;) {
        const lines = Math.max(1, ...remaining.map((cell) => cell.length));
        const needed = lines * lineHeight + padV * 2;
        const fullPage = this.continuationTop - this.bottom - headerHeight;
        let slice = lines;
        // The last row travels with the following block when both cannot share this page.
        // The last body row travels with the totals below it (and what follows the table); the
        // table's final row travels with the following block (keepWithNext / closing section).
        const after = tailStart > 0 && tailStart < normalized.length && rowIndex === tailStart - 1 ? tailHeight + keep
          : rowIndex === normalized.length - 1 && rowIndex > 0 ? keep : 0;
        if (after && this.y - needed >= this.bottom && this.y - needed - after < this.bottom && needed + after <= fullPage) {
          this.addPage(); drawHeader(); continue;
        }
        if (this.y - needed < this.bottom) {
          const fit = Math.floor((this.y - this.bottom - padV * 2) / lineHeight);
          if (needed > fullPage && fit >= 3) slice = fit;
          else { this.addPage(); drawHeader(); continue; }
        }
        const height = slice * lineHeight + padV * 2;
        const top = this.y;
        if (row.kind === "group") this.rect(this.left, top - height, this.contentWidth, height, { fill: PDF_COLORS.groupFill });
        if (bold) {
          this.rect(this.left, top - height, this.contentWidth, height, { fill: PDF_COLORS.fill });
          this.rule(top, { thickness: 0.8, color: PDF_COLORS.ink });
        }
        if (row.kind === "group") {
          remaining[0].slice(0, slice).forEach((line, lineIndex) =>
            this.text(line, this.left + padX, top - padV - size * 0.95 - lineIndex * lineHeight, { size, bold: true, color: PDF_COLORS.ink }));
        } else {
          remaining.forEach((cell, index) => cell.slice(0, slice).forEach((line, lineIndex) => {
            if (!line) return;
            this.text(line, cellX(index), top - padV - size * 0.95 - lineIndex * lineHeight,
              { size: wraps[index] ? laid.sizes[index] : fitSize(line, index, bold), bold, color: PDF_COLORS.ink, align: columns[index].align ?? "left" });
          }));
        }
        this.y = top - height;
        this.rule(this.y, { color: bold ? PDF_COLORS.rule : PDF_COLORS.hairline });
        if (slice >= lines) break;
        remaining = remaining.map((cell) => cell.slice(slice));
        this.addPage();
        drawHeader();
      }
    });
    this.rule(this.y, { thickness: 0.9, color: PDF_COLORS.ink });
    this.y -= 12;
  }

  /** Right-aligned totals block; emphasis rows are ruled and filled. */
  totals(rows: PdfTotalRow[], options: { width?: number; caption?: string } = {}) {
    if (!rows.length) return;
    const width = Math.min(options.width ?? 250, this.contentWidth);
    const x = this.right - width;
    const padX = 7;
    const rowHeight = 16;
    const height = rows.reduce((sum, row) => sum + (row.emphasis ? rowHeight + 3 : rowHeight), 0) + (options.caption ? 12 : 0);
    this.ensureLast(height + 4);
    if (options.caption) {
      this.text(options.caption, this.right, this.y - 7, { size: 7, color: PDF_COLORS.muted, align: "right" });
      this.y -= 12;
    }
    this.rule(this.y, { from: x, color: PDF_COLORS.rule, thickness: 0.6 });
    for (const row of rows) {
      const h = row.emphasis ? rowHeight + 3 : rowHeight;
      const top = this.y;
      if (row.emphasis) {
        this.rect(x, top - h, width, h, { fill: PDF_COLORS.fill });
        this.rule(top, { from: x, thickness: 0.9, color: PDF_COLORS.ink });
      }
      const size = row.emphasis ? 9.5 : 8.5;
      const color = row.muted ? PDF_COLORS.muted : PDF_COLORS.ink;
      const valueWidth = this.measure(row.value, size, true);
      const label = this.wrap(row.label, size, width - padX * 3 - valueWidth, row.emphasis)[0] ?? "";
      const baseline = top - h / 2 - size * 0.35;
      this.text(label, x + padX, baseline, { size, bold: row.emphasis, color });
      this.text(row.value, this.right - padX, baseline, { size, bold: true, color, align: "right" });
      this.y = top - h;
      this.rule(this.y, { from: x, color: row.emphasis ? PDF_COLORS.ink : PDF_COLORS.hairline, thickness: row.emphasis ? 0.9 : 0.5 });
    }
    this.y -= 12;
  }

  /** "Amount in words" strip. */
  amountInWords(words: string, label = "Amount in words") {
    const lines = this.wrap(words, 8.5, this.contentWidth - 16, true);
    const height = 12 + lines.length * 12 + 8;
    this.ensureLast(height);
    const top = this.y;
    this.rect(this.left, top - height, this.contentWidth, height, { border: PDF_COLORS.rule, borderWidth: 0.6 });
    this.text(label.toUpperCase(), this.left + 8, top - 10, { size: 6.8, bold: true, color: PDF_COLORS.muted });
    lines.forEach((line, index) => this.text(line, this.left + 8, top - 22.5 - index * 12, { size: 8.5, bold: true, color: PDF_COLORS.ink }));
    this.y = top - height - 12;
  }

  /** Full-width bordered notice for draft, cancelled, reversed or restricted documents. */
  notice(message: string, tone: StampTone = "neutral") {
    const color = tone === "void" ? PDF_COLORS.void : tone === "warning" ? PDF_COLORS.warning : tone === "positive" ? PDF_COLORS.positive : PDF_COLORS.ink;
    const lines = this.wrap(message, 8.5, this.contentWidth - 18, true);
    const height = lines.length * 12 + 10;
    this.ensureLast(height);
    const top = this.y;
    this.rect(this.left, top - height, this.contentWidth, height, { border: color, borderWidth: 0.9 });
    this.rect(this.left, top - height, 3, height, { fill: color });
    lines.forEach((line, index) => this.text(line, this.left + 11, top - 13 - index * 12, { size: 8.5, bold: true, color }));
    this.y = top - height - 12;
  }

  /** Signature boxes; `forName` prints "For <company>" above the last box. */
  private signatureLayout(labels: string[], options: { forName?: string }) {
    const gap = 24;
    const width = (this.contentWidth - gap * (labels.length - 1)) / labels.length;
    const forLines = options.forName ? this.wrap(`For ${options.forName}`, 8.5, Math.max(width, this.contentWidth / 2), true) : [];
    return { gap, width, forLines, height: 54 + forLines.length * 11.5 };
  }

  /** Height of the signature row drawn by signatures(). */
  signatureHeight(labels: string[], options: { forName?: string } = {}) {
    return labels.length ? this.signatureLayout(labels, options).height : 0;
  }

  signatures(labels: string[], options: { forName?: string } = {}) {
    this.closingReserve = 0;
    if (!labels.length) return;
    const { gap, width, forLines, height: fullHeight } = this.signatureLayout(labels, options);
    // Up to 10 pt less signing space is used when that keeps the block on the current page,
    // so a page never carries nothing but the signature lines.
    let height = fullHeight;
    if (this.y - height < this.bottom && this.y - (height - 10) >= this.bottom) height -= 10;
    this.ensure(height);
    const top = this.y;
    forLines.forEach((line, index) => this.text(line, this.right, top - 9 - index * 11.5, { size: 8.5, bold: true, color: PDF_COLORS.ink, align: "right" }));
    labels.forEach((label, index) => {
      const x = this.left + index * (width + gap);
      const lineY = top - height + 18;
      this.rule(lineY, { from: x, to: x + width, color: PDF_COLORS.rule, thickness: 0.6 });
      const isLast = index === labels.length - 1;
      this.text(label, isLast && options.forName ? x + width : x, lineY - 10, { size: 7.5, color: PDF_COLORS.muted, align: isLast && options.forName ? "right" : "left" });
    });
    this.y = top - height;
  }
}
