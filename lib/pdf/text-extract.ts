// AP-020: the text layer of a digital PDF (most supplier mill certificates are generated, not scanned). Reads the page
// content streams (plain or Flate-compressed) and the strings shown by Tj/TJ/'/" operators, one line per text line.
// Fonts that encode glyph numbers instead of characters (Identity-H subsets) and scanned images return null, so the
// certificate is read by a person instead: the draft stays blank rather than guessing.
import { inflateSync } from "node:zlib";

const MAX_STREAMS = 400;
const MAX_TEXT = 200_000;

function decodeLiteral(raw: string) {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== "\\") { out += ch; continue; }
    const next = raw[++i];
    if (next === undefined) break;
    const map: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" };
    if (map[next] !== undefined) { out += map[next]; continue; }
    if (/[0-7]/.test(next)) {
      let oct = next;
      while (oct.length < 3 && /[0-7]/.test(raw[i + 1] ?? "")) oct += raw[++i];
      out += String.fromCharCode(parseInt(oct, 8) & 0xff); continue;
    }
    if (next === "\n" || next === "\r") continue;
    out += next;
  }
  return out;
}

function decodeHex(hex: string) {
  const clean = hex.replace(/[^0-9a-f]/gi, "");
  const padded = clean.length % 2 ? `${clean}0` : clean;
  let out = "";
  for (let i = 0; i < padded.length; i += 2) out += String.fromCharCode(parseInt(padded.slice(i, i + 2), 16));
  return out;
}

/** Share of characters that are readable text; glyph-id encodings fail this. */
function readable(value: string) {
  if (!value.length) return 1;
  const ok = [...value].filter(ch => /[\x20-\x7e -ÿ\n]/.test(ch)).length;
  return ok / value.length;
}

/** Strings shown in one content stream, with a line break wherever the text position moves to a new line. */
export function contentStreamText(content: string) {
  const lines: string[] = []; let line = ""; let inText = false;
  const flush = () => { if (line.trim()) lines.push(line.replace(/\s+/g, " ").trim()); line = ""; };
  const operands: string[] = [];
  let i = 0;
  while (i < content.length) {
    const ch = content[i];
    if (ch === "(") {
      let depth = 1, j = i + 1, raw = "";
      while (j < content.length && depth > 0) {
        const c = content[j];
        if (c === "\\") { raw += c + (content[j + 1] ?? ""); j += 2; continue; }
        if (c === "(") depth++; else if (c === ")") { depth--; if (!depth) break; }
        raw += c; j++;
      }
      operands.push(decodeLiteral(raw)); i = j + 1; continue;
    }
    if (ch === "<" && content[i + 1] !== "<") {
      const end = content.indexOf(">", i);
      if (end < 0) break;
      operands.push(decodeHex(content.slice(i + 1, end))); i = end + 1; continue;
    }
    if (ch === "[") {
      // TJ array: strings and kerning numbers; a large negative kern is a word gap.
      const end = content.indexOf("]", i);
      if (end < 0) break;
      const body = content.slice(i + 1, end); let text = "";
      const re = /\(((?:\\.|[^\\)])*)\)|<([0-9a-fA-F\s]*)>|(-?\d+(?:\.\d+)?)/g;
      for (const m of body.matchAll(re)) {
        if (m[1] !== undefined) text += decodeLiteral(m[1]);
        else if (m[2] !== undefined) text += decodeHex(m[2]);
        else if (m[3] !== undefined && Number(m[3]) < -180) text += " ";
      }
      operands.push(text); i = end + 1; continue;
    }
    if (/\s/.test(ch)) { i++; continue; }
    const word = /^[A-Za-z'"*]+/.exec(content.slice(i, i + 4))?.[0];
    if (word) {
      if (word === "BT") { inText = true; flush(); }
      else if (word === "ET") { inText = false; flush(); }
      else if (inText && (word === "Tj" || word === "TJ")) line += `${operands.pop() ?? ""} `;
      else if (inText && (word === "'" || word === '"')) { flush(); line += `${operands.pop() ?? ""} `; }
      else if (inText && (word === "Td" || word === "TD" || word === "T*" || word === "Tm")) {
        // Same-line moves (only x changes) keep the line; a change in y starts a new one.
        const nums = operands.slice(-2).map(Number);
        if (word === "T*" || (word !== "Tm" && nums.length === 2 && Math.abs(nums[1]) > 0.01) || word === "Tm") flush(); else line += " ";
      }
      if (!["Tj", "TJ", "'", '"'].includes(word)) operands.length = 0;
      i += word.length; continue;
    }
    const num = /^-?\d*\.?\d+/.exec(content.slice(i, i + 24))?.[0];
    if (num) { operands.push(num); i += num.length; continue; }
    i++;
  }
  flush();
  return lines;
}

/** The text of a PDF, or null when it has no readable text layer. */
export function extractPdfText(bytes: Uint8Array): string | null {
  const source = Buffer.from(bytes).toString("latin1");
  if (!source.startsWith("%PDF")) return null;
  const lines: string[] = [];
  const re = /<<((?:[^<>]|<(?!<)|<<(?:[^<>]|<(?!<))*>>)*)>>\s*stream\r?\n/g;
  let match: RegExpExecArray | null; let streams = 0;
  while ((match = re.exec(source)) && streams < MAX_STREAMS) {
    streams++;
    const start = match.index + match[0].length;
    const end = source.indexOf("endstream", start);
    if (end < 0) break;
    const dict = match[1];
    if (/\/Subtype\s*\/(Image|XML)|\/Type\s*\/(XObject|Metadata|XRef|ObjStm)|\/Length1|\/FontFile/.test(dict)) continue;
    let body = source.slice(start, end).replace(/\r?\n$/, "");
    if (/\/Filter\s*\[?\s*\/FlateDecode/.test(dict)) {
      try { body = inflateSync(Buffer.from(body, "latin1")).toString("latin1"); } catch { continue; }
    } else if (/\/Filter/.test(dict)) continue;
    if (!/\bBT\b/.test(body)) continue;
    lines.push(...contentStreamText(body));
    if (lines.join("\n").length > MAX_TEXT) break;
  }
  const text = lines.join("\n");
  if (text.replace(/\s/g, "").length < 20 || readable(text) < 0.85) return null;
  return text;
}
