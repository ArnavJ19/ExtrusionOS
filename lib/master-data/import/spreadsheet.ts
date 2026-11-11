// AP-006: reads the first sheet of an .xlsx workbook or a .csv file into rows of text cells. Server-only (node:zlib).
// No dependency is added: an .xlsx file is a zip of XML parts, and only the parts holding cell text are read.
import { inflateRawSync } from "node:zlib";

export const MAX_SHEET_BYTES = 4 * 1024 * 1024; // Vercel request bodies are limited to 4.5 MB
export const MAX_SHEET_ROWS = 5000;
const MAX_PART_BYTES = 40 * 1024 * 1024;

export type Sheet = { headers: string[]; rows: Array<{ row: number; cells: string[] }>; sheetName: string | null };
export class SheetError extends Error {}

function decodeXml(value: string) {
  return value.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower === "lt") return "<"; if (lower === "gt") return ">"; if (lower === "amp") return "&"; if (lower === "quot") return "\""; if (lower === "apos") return "'";
    const code = lower.startsWith("#x") ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
  });
}

function readZip(buffer: Buffer) {
  let eocd = -1;
  for (let index = buffer.length - 22; index >= Math.max(0, buffer.length - 65557); index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) { eocd = index; break; }
  }
  if (eocd < 0) throw new SheetError("This file is not a readable Excel workbook. Save it as .xlsx or .csv and try again.");
  const entries = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const files = new Map<string, { method: number; compressed: number; size: number; local: number }>();
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw new SheetError("The workbook's file index is damaged.");
    const method = buffer.readUInt16LE(offset + 10), compressed = buffer.readUInt32LE(offset + 20), size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28), extraLength = buffer.readUInt16LE(offset + 30), commentLength = buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42);
    files.set(buffer.toString("utf8", offset + 46, offset + 46 + nameLength), { method, compressed, size, local });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return (name: string) => {
    const entry = files.get(name);
    if (!entry) return null;
    if (entry.size > MAX_PART_BYTES) throw new SheetError("The workbook is too large to read. Keep the sheet under 5,000 rows.");
    if (buffer.readUInt32LE(entry.local) !== 0x04034b50) throw new SheetError("The workbook is damaged.");
    const start = entry.local + 30 + buffer.readUInt16LE(entry.local + 26) + buffer.readUInt16LE(entry.local + 28);
    const data = buffer.subarray(start, start + entry.compressed);
    if (entry.method === 0) return data.toString("utf8");
    if (entry.method === 8) return inflateRawSync(data, { maxOutputLength: MAX_PART_BYTES }).toString("utf8");
    throw new SheetError("The workbook uses an unsupported compression. Save it again from Excel as .xlsx.");
  };
}

function columnIndex(reference: string) {
  const letters = reference.replace(/[^A-Z]/gi, "").toUpperCase();
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

function textOf(fragment: string) {
  return decodeXml([...fragment.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(match => match[1]).join(""));
}

type Table = Array<{ row: number; cells: string[] }>;

export function parseXlsx(buffer: Buffer): Sheet {
  const { table, sheetName } = xlsxTable(buffer);
  return toSheet(table, sheetName);
}

function xlsxTable(buffer: Buffer): { table: Table; sheetName: string | null } {
  const read = readZip(buffer);
  const workbook = read("xl/workbook.xml");
  if (!workbook) throw new SheetError("This file has no workbook. Save it as .xlsx or .csv and try again.");
  const firstSheet = workbook.match(/<sheet\b[^>]*>/);
  const sheetName = firstSheet ? decodeXml(firstSheet[0].match(/\bname="([^"]*)"/)?.[1] ?? "") || null : null;
  const relationId = firstSheet?.[0].match(/\br:id="([^"]+)"/)?.[1];
  let target = "xl/worksheets/sheet1.xml";
  const rels = read("xl/_rels/workbook.xml.rels");
  if (rels && relationId) {
    const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map(match => match[0]).find(tag => tag.includes(`Id="${relationId}"`));
    const path = rel?.match(/\bTarget="([^"]+)"/)?.[1];
    if (path) target = path.startsWith("/") ? path.slice(1) : `xl/${path.replace(/^\.\//, "")}`;
  }
  const shared = (read("xl/sharedStrings.xml") ?? "").match(/<si>[\s\S]*?<\/si>/g)?.map(textOf) ?? [];
  const xml = read(target);
  if (!xml) throw new SheetError("The first sheet of the workbook could not be found.");
  const table: Array<{ row: number; cells: string[] }> = [];
  for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rowNumber = Number(rowMatch[1].match(/\br="(\d+)"/)?.[1] ?? table.length + 1);
    const cells: string[] = [];
    let position = 0;
    for (const cell of rowMatch[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[1], body = cell[2] ?? "";
      const ref = attrs.match(/\br="([A-Z]+)\d+"/i)?.[1];
      const index = ref ? columnIndex(ref) : position;
      position = index + 1;
      if (index > 200) continue;
      const type = attrs.match(/\bt="([^"]+)"/)?.[1];
      const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let value = "";
      if (type === "s") value = shared[Number(raw)] ?? "";
      else if (type === "inlineStr") value = textOf(body);
      else if (type === "b") value = raw === "1" ? "TRUE" : raw === "0" ? "FALSE" : "";
      else value = raw !== undefined ? decodeXml(raw) : "";
      cells[index] = value;
    }
    table.push({ row: rowNumber, cells: Array.from(cells, value => value ?? "") });
    if (table.length > MAX_SHEET_ROWS + 1) throw new SheetError(`A sheet may hold up to ${MAX_SHEET_ROWS.toLocaleString("en-IN")} rows.`);
  }
  return { table, sheetName };
}

export function parseCsv(text: string): Sheet {
  return toSheet(csvTable(text), null);
}

function csvTable(text: string): Table {
  const source = text.replace(/^﻿/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [",", ";", "\t"].map(candidate => ({ candidate, count: firstLine.split(candidate).length })).sort((a, b) => b.count - a.count)[0].candidate;
  const table: Array<{ row: number; cells: string[] }> = [];
  let cells: string[] = [], field = "", quoted = false, row = 1;
  const pushRow = () => { cells.push(field); table.push({ row, cells }); cells = []; field = ""; row += 1; };
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === "\"" && source[index + 1] === "\"") { field += "\""; index += 1; }
      else if (char === "\"") quoted = false;
      else field += char;
    } else if (char === "\"" && field === "") quoted = true;
    else if (char === delimiter) { cells.push(field); field = ""; }
    else if (char === "\n" || char === "\r") { if (char === "\r" && source[index + 1] === "\n") index += 1; pushRow(); }
    else field += char;
    if (table.length > MAX_SHEET_ROWS + 1) throw new SheetError(`A sheet may hold up to ${MAX_SHEET_ROWS.toLocaleString("en-IN")} rows.`);
  }
  if (field !== "" || cells.length) pushRow();
  return table;
}

function toSheet(table: Array<{ row: number; cells: string[] }>, sheetName: string | null): Sheet {
  const nonEmpty = table.filter(entry => entry.cells.some(cell => cell.trim() !== ""));
  if (!nonEmpty.length) throw new SheetError("The sheet is empty.");
  const [header, ...rows] = nonEmpty;
  const headers = header.cells.map(cell => cell.trim());
  if (!headers.some(Boolean)) throw new SheetError("The first row must hold the column headings.");
  return { headers, rows: rows.map(entry => ({ row: entry.row, cells: headers.map((_, index) => (entry.cells[index] ?? "").trim()) })), sheetName };
}

function readTable(fileName: string, buffer: Buffer): { table: Table; sheetName: string | null } {
  if (buffer.length > MAX_SHEET_BYTES) throw new SheetError("Keep the file under 4 MB (about 20,000 rows of an ordinary master sheet).");
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm")) return xlsxTable(buffer);
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) return { table: csvTable(buffer.toString("utf8")), sheetName: null };
  if (lower.endsWith(".xls")) throw new SheetError("Old .xls workbooks cannot be read. In Excel use Save As → Excel Workbook (.xlsx).");
  throw new SheetError("Upload an .xlsx or .csv file.");
}

export function parseSpreadsheet(fileName: string, buffer: Buffer): Sheet {
  const { table, sheetName } = readTable(fileName, buffer);
  return toSheet(table, sheetName);
}

/**
 * Every non-empty row as read, trimmed but not cut to the first row's width. For files whose heading row is not the
 * first row (bank statements put account details above it), so the caller can find the heading row itself.
 */
export function parseSpreadsheetGrid(fileName: string, buffer: Buffer): string[][] {
  const grid = readTable(fileName, buffer).table.map(entry => entry.cells.map(cell => (cell ?? "").trim())).filter(cells => cells.some(Boolean));
  if (!grid.length) throw new SheetError("The sheet is empty.");
  return grid;
}
