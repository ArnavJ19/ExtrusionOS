"use server";

// Autopilot batch 3 server actions that need more than one database call: reading an uploaded bank statement (AP-024)
// and posting invoice drafts through the reviewed invoice path (AP-046). Company and actor come from the session; the
// database re-checks every step.
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { saveInvoiceAction } from "@/lib/actions/invoices";
import { parseSpreadsheetGrid, SheetError, MAX_SHEET_BYTES } from "@/lib/master-data/import/spreadsheet";
import { BANK_DATE_FORMATS, autoMapBank, bankMappingSchema, buildStatementRows, findHeaderRow, headerSignatureSource, parseBankDate,
  type BankDateFormat, type BankMapping, type StatementRow, type StatementRowError } from "@/lib/financials/bank-statement";

type Result<T> = { success: true; data: T } | { success: false; error: string };
const ACCOUNTS = ["owner", "admin", "accounts"];

export type BankPreview = {
  fileName: string; fingerprint: string; headerSignature: string; headers: string[]; headerIndex: number; mapping: BankMapping; dateFormat: BankDateFormat;
  remembered: string | null; sample: StatementRow[]; rowCount: number; credits: number; errors: StatementRowError[];
};

async function readGrid(file: File) {
  if (!(file instanceof File) || file.size === 0) throw new SheetError("Choose the statement file.");
  if (file.size > MAX_SHEET_BYTES) throw new SheetError("The file is larger than 4 MB. Export a shorter period.");
  const buffer = Buffer.from(await file.arrayBuffer());
  // The raw grid: the first row is often account details, so rows are not cut to its width before the heading row is found.
  const grid = parseSpreadsheetGrid(file.name, buffer);
  const headerIndex = findHeaderRow(grid);
  if (headerIndex < 0) throw new SheetError("No heading row with a date and a narration column was found in the first 40 rows.");
  return { grid, headerIndex, headers: grid[headerIndex].map(String), fingerprint: createHash("sha256").update(buffer).digest("hex") };
}

function guessFormat(grid: string[][], headerIndex: number, column: number): BankDateFormat {
  const cells = grid.slice(headerIndex + 1, headerIndex + 41).map(row => String(row[column] ?? "")).filter(Boolean);
  let best: BankDateFormat = "DD/MM/YYYY", bestCount = -1;
  for (const format of BANK_DATE_FORMATS) {
    const count = cells.filter(cell => parseBankDate(cell, format)).length;
    if (count > bestCount) { best = format; bestCount = count; }
  }
  return best;
}

async function gate() {
  const context = await getSessionContext();
  if (context.dealerId || !ACCOUNTS.includes(context.role)) throw new Error("permission");
  return context;
}

export async function previewBankStatementAction(form: FormData): Promise<Result<BankPreview>> {
  try {
    await gate();
    const file = form.get("file") as File;
    const { grid, headerIndex, headers, fingerprint } = await readGrid(file);
    const headerSignature = createHash("md5").update(headerSignatureSource(headers)).digest("hex");
    const supabase = await createClient();
    const remembered = await supabase.rpc("ap_cash", { p_command: "bank_profiles", p_payload: { header_signature: headerSignature } });
    const profile = Array.isArray(remembered.data) ? (remembered.data[0] as { name: string; mapping: BankMapping; date_format: BankDateFormat } | undefined) : undefined;
    const mapping = profile ? bankMappingSchema.parse(profile.mapping) : autoMapBank(headers);
    const dateFormat = profile?.date_format ?? guessFormat(grid, headerIndex, mapping.date);
    const built = buildStatementRows(grid, headerIndex, mapping, dateFormat);
    return { success: true, data: { fileName: file.name, fingerprint, headerSignature, headers, headerIndex, mapping, dateFormat, remembered: profile?.name ?? null,
      sample: built.rows.slice(0, 10), rowCount: built.rows.length, credits: built.rows.filter(r => r.credit).length, errors: built.errors.slice(0, 20) } };
  } catch (error) {
    if (error instanceof Error && error.message === "permission") return { success: false, error: "Only accounts, an admin or the owner can import bank statements." };
    return { success: false, error: error instanceof SheetError ? error.message : "The file could not be read. Save it as .xlsx or .csv and try again." };
  }
}

const importSchema = z.object({
  mapping: bankMappingSchema, dateFormat: z.enum(BANK_DATE_FORMATS), profileName: z.string().trim().min(3).max(80).optional(), accountLabel: z.string().trim().max(80).optional()
});

export type BankImportResult = { statement_id: string; already_imported: boolean; rows?: number; new_lines?: number; duplicates?: number; repeated_in_file?: number; credits?: number; exact?: number;
  likely?: number; unknown?: number; errors?: StatementRowError[]; file_errors: StatementRowError[] };

export async function importBankStatementAction(form: FormData): Promise<Result<BankImportResult>> {
  try {
    await gate();
    const options = importSchema.safeParse({ mapping: JSON.parse(String(form.get("mapping") ?? "null")), dateFormat: form.get("dateFormat"),
      profileName: form.get("profileName") || undefined, accountLabel: form.get("accountLabel") || undefined });
    if (!options.success) return { success: false, error: options.error.issues[0]?.message ?? "Review the column choices." };
    const file = form.get("file") as File;
    const { grid, headerIndex, headers, fingerprint } = await readGrid(file);
    const built = buildStatementRows(grid, headerIndex, options.data.mapping, options.data.dateFormat);
    if (!built.rows.length) return { success: false, error: "No readable transaction rows were found with these columns." };
    if (built.rows.length > 3000) return { success: false, error: "A statement can have at most 3,000 rows. Export a shorter period." };
    const supabase = await createClient();
    const result = await supabase.rpc("ap_cash", { p_command: "bank_import", p_payload: {
      source_name: file.name.slice(0, 200), file_fingerprint: fingerprint, account_label: options.data.accountLabel ?? null, rows: built.rows,
      ...(options.data.profileName ? { profile: { name: options.data.profileName, header_signature: createHash("md5").update(headerSignatureSource(headers)).digest("hex"),
        mapping: options.data.mapping, date_format: options.data.dateFormat } } : {}) } });
    if (result.error) {
      return { success: false, error: result.error.message?.startsWith("AP: ") ? result.error.message.slice(4)
        : result.error.code === "42501" ? "Only accounts, an admin or the owner can import bank statements." : "The statement could not be imported. Retry." };
    }
    try { revalidatePath("/payments/bank"); } catch { /* the import stands */ }
    return { success: true, data: { ...(result.data as BankImportResult), file_errors: built.errors } };
  } catch (error) {
    if (error instanceof Error && error.message === "permission") return { success: false, error: "Only accounts, an admin or the owner can import bank statements." };
    return { success: false, error: error instanceof SheetError ? error.message : "The file could not be read. Save it as .xlsx or .csv and try again." };
  }
}

export type DraftPostResult = { id: string; state: "posted" | "changed" | "failed"; message?: string; invoice_id?: string };

/** AP-046: posts drafts in a batch. Each one runs the reviewed invoice save (which allocates the number); a draft whose
 * packing list changed since it was prepared is refreshed instead and must be reviewed again. */
export async function postInvoiceDraftsAction(ids: string[]): Promise<Result<DraftPostResult[]>> {
  try {
    await gate();
    const parsed = z.array(z.string().uuid()).min(1).max(50).safeParse(ids);
    if (!parsed.success) return { success: false, error: "Choose 1 to 50 drafts." };
    const supabase = await createClient();
    const prepared = await supabase.rpc("ap_billing", { p_command: "post_data", p_payload: { ids: parsed.data } });
    if (prepared.error) return { success: false, error: prepared.error.message?.startsWith("AP: ") ? prepared.error.message.slice(4) : "The drafts could not be read. Retry." };
    const results: DraftPostResult[] = [];
    for (const row of (prepared.data as { rows: Array<Record<string, string | null>> }).rows) {
      if (row.state !== "ready") { results.push({ id: String(row.id), state: row.state === "changed" ? "changed" : "failed", message: row.message ?? undefined }); continue; }
      const saved = await saveInvoiceAction({ order_id: String(row.order_id), dispatch_id: String(row.dispatch_id), place_of_supply_state_code: String(row.place_of_supply_state_code),
        invoice_date: String(row.invoice_date), due_date: row.due_date, status: "generated", source_fingerprint: String(row.source_fingerprint),
        notes: "Posted from the gate-out invoice draft" });
      results.push(saved.success ? { id: String(row.id), state: "posted", invoice_id: saved.invoiceId } : { id: String(row.id), state: "failed", message: saved.error });
    }
    try { revalidatePath("/invoices/drafts"); revalidatePath("/invoices"); } catch { /* the outcome stands */ }
    return { success: true, data: results };
  } catch (error) {
    if (error instanceof Error && error.message === "permission") return { success: false, error: "Only accounts, an admin or the owner can post invoices." };
    return { success: false, error: "The drafts could not be posted. Check your connection and retry." };
  }
}
