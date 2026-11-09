// AP-006 / AP-007: server-side handling of an uploaded go-live sheet. Used by the upload route handlers; takes the
// caller's Supabase client so every database step runs as the signed-in employee under RLS.
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CUTOVER_DEFINITIONS, MASTER_DEFINITIONS, type CutoverSectionKey, type MasterKey } from "./definitions.ts";
import { autoMap, headerSignatureSource, mappingProblems, validateSheet, type ColumnMapping } from "./engine.ts";
import { parseSpreadsheet, SheetError } from "./spreadsheet.ts";

export type UploadOutcome<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

function sheetFrom(fileName: string, buffer: Buffer) {
  try { return { sheet: parseSpreadsheet(fileName, buffer) }; }
  catch (error) { return { error: error instanceof SheetError ? error.message : "The file could not be read. Save it as .xlsx or .csv and try again." }; }
}

function rpcError(error: { code?: string; message?: string }): UploadOutcome<never> {
  if (error.code === "42501") return { ok: false, status: 403, error: "Only the owner or an admin can import masters." };
  if (error.code === "P0001" && error.message?.startsWith("AP: ")) return { ok: false, status: 400, error: error.message.slice(4) };
  if (["PGRST202", "42883"].includes(error.code ?? "")) return { ok: false, status: 503, error: "This needs the Autopilot batch 1 database upgrade." };
  return { ok: false, status: 500, error: "The sheet could not be checked against current records. Retry." };
}

export async function previewMasterUpload(supabase: SupabaseClient, input: { master: MasterKey; fileName: string; buffer: Buffer; mapping?: ColumnMapping | null }) {
  const definition = MASTER_DEFINITIONS[input.master];
  const read = sheetFrom(input.fileName, input.buffer);
  if (!read.sheet) return { ok: false, status: 400, error: read.error! } as const;
  const sheet = read.sheet;
  const signature = createHash("md5").update(headerSignatureSource(sheet.headers)).digest("hex");
  let remembered: ColumnMapping | null = null;
  if (!input.mapping) {
    const prior = await supabase.rpc("ap_import", { p_command: "mapping", p_payload: { master: input.master, header_signature: signature } });
    if (prior.error) return rpcError(prior.error);
    remembered = (prior.data as { mapping: ColumnMapping | null })?.mapping ?? null;
  }
  const mapping = input.mapping ? Object.fromEntries(sheet.headers.filter(Boolean).map(header => [header, input.mapping?.[header] ?? null])) : autoMap(sheet.headers, definition, remembered);
  const problems = mappingProblems(mapping, definition);
  const base = { master: input.master, file_name: input.fileName, headers: sheet.headers.filter(Boolean), mapping, remembered: Boolean(remembered), problems,
    fields: definition.fields.map(field => ({ key: field.key, label: field.label, required: Boolean(field.required) })), total_rows: sheet.rows.length };
  if (problems.missing.length || problems.duplicates.length || problems.unknown.length) return { ok: true, data: { ...base, batch_id: null, valid_rows: 0, rejected_rows: 0, rejected: [], sample: [] } } as const;
  const { valid, rejected } = validateSheet(sheet, mapping, definition);
  const staged = await supabase.rpc("ap_import", { p_command: "stage", p_payload: {
    master: input.master, file_name: input.fileName.slice(0, 200), file_sha256: createHash("sha256").update(input.buffer).digest("hex"), header_signature: signature, mapping,
    rows: valid, rejected
  } });
  if (staged.error) return rpcError(staged.error);
  const data = staged.data as { batch_id: string; valid_rows: number; rejected_rows: number; rejected: Array<{ row: number; errors: string[]; values: Record<string, string> }>; sample: unknown[] };
  return { ok: true, data: { ...base, batch_id: data.batch_id, valid_rows: data.valid_rows, rejected_rows: data.rejected_rows, rejected: data.rejected.slice(0, 50), sample: data.sample } } as const;
}

export async function loadCutoverUpload(supabase: SupabaseClient, input: { section: CutoverSectionKey; fileName: string; buffer: Buffer; control: { count: number; quantity: number | null; amount: number | null } }) {
  const definition = CUTOVER_DEFINITIONS[input.section];
  const read = sheetFrom(input.fileName, input.buffer);
  if (!read.sheet) return { ok: false, status: 400, error: read.error! } as const;
  const mapping = autoMap(read.sheet.headers, definition, null);
  const problems = mappingProblems(mapping, definition);
  if (problems.missing.length) return { ok: false, status: 400, error: `The sheet needs these columns: ${problems.missing.join(", ")}. Download the template for the exact headings.` } as const;
  const { valid, rejected } = validateSheet(read.sheet, mapping, definition);
  if (rejected.length) return { ok: true, data: { state: "rejected" as const, errors: rejected.slice(0, 50).map(row => ({ row: row.row, errors: row.errors })), rows: valid.length + rejected.length } } as const;
  const result = await supabase.rpc("ap_cutover", { p_command: "load", p_payload: {
    section: input.section, file_name: input.fileName.slice(0, 200), file_sha256: createHash("sha256").update(input.buffer).digest("hex"),
    rows: valid.map(row => ({ row: row.row, values: row.values })), control: input.control
  } });
  if (result.error) {
    if (result.error.code === "42501") return { ok: false, status: 403, error: "Your role cannot load this section." } as const;
    return rpcError(result.error);
  }
  return { ok: true, data: { ...(result.data as { state: "loaded" | "rejected"; errors?: Array<{ row: number; errors: string[] }>; totals?: unknown }), rows: valid.length } } as const;
}
