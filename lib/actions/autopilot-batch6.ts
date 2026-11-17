"use server";

// Autopilot batch 6 server actions that build or compute before the database records the result:
// AP-082 e-invoice export (file built from issued invoices, recorded as exported only after it is built) and IRN import
// (response parsed and cross-checked against its signed QR), AP-077 statement import (CSV parsed into reviewable rows,
// original text kept) and AP-029 billet length (options computed by lib/calculations/billet-length; the database checks
// the press limits and that the inputs have not changed since the options were shown).
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { EINVOICE_SCHEMA_VERSION, buildEinvoiceExport, parseIrnResponse, type EinvoiceIssue, type EinvoiceSource } from "@/lib/compliance/e-invoice";
import { parseTdsStatement } from "@/lib/financials/tds-statement";
import { planBilletLength, type BilletOption, type BilletPlan, type BilletPress } from "@/lib/calculations/billet-length";
import { BILLET_PLANNERS, BILLET_READERS, FINANCE_ROLES } from "@/lib/autopilot-batch6/commands";

type Result<T> = { success: true; data: T } | { success: false; error: string };
type DbError = { code?: string; message?: string } | null;
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

function dbMessage(error: DbError, fallback: string) {
  const message = error?.message ?? "";
  if (["PGRST202", "42883", "42P01"].includes(error?.code ?? "")) return "This needs the Autopilot database upgrade.";
  if (error?.code === "42501") return "This action is not available to your current session.";
  if (message.startsWith("AP: ")) return message.slice(4);
  return fallback;
}
async function allowed(roles: readonly string[]) {
  const ctx = await getSessionContext();
  if (ctx.dealerId || !roles.includes(ctx.role)) throw new Error("permission");
  return ctx;
}
const refresh = (...paths: string[]) => { for (const path of paths) { try { revalidatePath(path); } catch { /* the database outcome stands */ } } };

export type EinvoiceExportResult = { json: string; filename: string; included: { invoice_number: string }[]; skipped: { invoice_number: string; issues: EinvoiceIssue[] }[] };
export async function exportEinvoiceAction(invoiceIds: string[]): Promise<Result<EinvoiceExportResult>> {
  try {
    await allowed(FINANCE_ROLES);
    const ids = z.array(z.string().uuid()).min(1).max(100).parse(invoiceIds);
    const supabase = await createClient();
    const read = await supabase.rpc("ap_einvoice", { p_command: "sources", p_payload: { invoice_ids: ids } });
    if (read.error) return { success: false, error: dbMessage(read.error, "The invoices could not be read.") };
    const built = buildEinvoiceExport(((read.data as { invoices: EinvoiceSource[] }).invoices) ?? []);
    const skipped = built.skipped.map(s => ({ invoice_number: s.source.invoice_number, issues: s.issues }));
    if (!built.included.length) return { success: true, data: { json: "", filename: "", included: [], skipped } };
    const json = JSON.stringify(built.file, null, 2);
    const recorded = await supabase.rpc("ap_einvoice", { p_command: "record_export", p_payload: { schema_version: EINVOICE_SCHEMA_VERSION, file_sha256: sha(json),
      invoices: built.included.map(s => ({ invoice_id: s.invoice_id, doc_no: s.invoice_number })) } });
    if (recorded.error) return { success: false, error: dbMessage(recorded.error, "The export could not be recorded. Nothing was marked exported.") };
    refresh("/invoices/einvoice");
    return { success: true, data: { json, filename: `e-invoice-${new Date().toISOString().slice(0, 10)}.json`, included: built.included.map(s => ({ invoice_number: s.invoice_number })), skipped } };
  } catch { return { success: false, error: "The e-invoice file could not be prepared. Check your session and retry." }; }
}

export type IrnImportResult = { recorded: number; results: { row: number; doc_no: string; state: string; message?: string }[]; problems: { index: number; message: string }[] };
export async function importIrnAction(text: string): Promise<Result<IrnImportResult>> {
  try {
    await allowed(FINANCE_ROLES);
    const body = z.string().min(2).max(5_000_000).parse(text);
    const parsed = parseIrnResponse(body);
    if (!parsed.rows.length) return { success: true, data: { recorded: 0, results: [], problems: parsed.problems } };
    const supabase = await createClient();
    const saved = await supabase.rpc("ap_einvoice", { p_command: "import_irn", p_payload: { file_sha256: sha(body), rows: parsed.rows } });
    if (saved.error) return { success: false, error: dbMessage(saved.error, "The IRN file could not be recorded.") };
    refresh("/invoices/einvoice", "/invoices");
    const data = saved.data as { recorded: number; results: IrnImportResult["results"] };
    return { success: true, data: { recorded: data.recorded, results: data.results, problems: parsed.problems } };
  } catch { return { success: false, error: "The IRN response could not be read. Check the file and retry." }; }
}

export type TdsImportResult = { import_id?: string; rows: number; unknown_tan: number; matched: number; problems: { row: number; message: string }[] };
export async function importTdsStatementAction(input: { fileName: string; text: string }): Promise<Result<TdsImportResult>> {
  try {
    await allowed(FINANCE_ROLES);
    const { fileName, text } = z.object({ fileName: z.string().trim().min(1).max(200), text: z.string().min(1).max(2_000_000) }).parse(input);
    const parsed = parseTdsStatement(text);
    if (!parsed.rows.length) return { success: true, data: { rows: 0, unknown_tan: 0, matched: 0, problems: parsed.problems } };
    const supabase = await createClient();
    const saved = await supabase.rpc("ap_tds", { p_command: "import_statement", p_payload: { file_name: fileName, file_sha256: sha(text), source_text: text, rows: parsed.rows } });
    if (saved.error) return { success: false, error: dbMessage(saved.error, "The statement could not be imported.") };
    refresh("/payments/tds");
    return { success: true, data: { ...(saved.data as Omit<TdsImportResult, "problems">), problems: parsed.problems } };
  } catch { return { success: false, error: "The statement could not be read. Export it as CSV and retry." }; }
}

type JobInputs = { job_id: string; job_number: string | null; status: string; machine_id: string | null; kg_per_m: number | null; cut_length_m: number | null; billet_diameter_mm: number | null;
  extrusion_ratio: number | null; die_number: string | null; profile_code: string | null; alloy: string | null; planned_quantity_kg: number | null; presses: (BilletPress & { machine_name: string })[];
  current: Record<string, unknown> | null; fingerprint: string };
export type BilletOptions = { inputs: JobInputs; plans: { press: BilletPress & { machine_name: string }; plan: BilletPlan }[] };

async function readOptions(jobId: string): Promise<{ data?: BilletOptions; error?: string }> {
  const supabase = await createClient();
  const read = await supabase.rpc("ap_billet_length", { p_command: "job_inputs", p_payload: { job_id: jobId } });
  if (read.error) return { error: dbMessage(read.error, "The job inputs could not be read.") };
  const inputs = read.data as JobInputs;
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const job = { kg_per_m: num(inputs.kg_per_m), cut_length_m: num(inputs.cut_length_m), billet_diameter_mm: num(inputs.billet_diameter_mm), extrusion_ratio: num(inputs.extrusion_ratio) };
  const presses = (inputs.presses ?? []).map(p => ({ ...p, min_billet_mm: Number(p.min_billet_mm), max_billet_mm: Number(p.max_billet_mm), standard_billet_mm: num(p.standard_billet_mm),
    container_diameter_mm: num(p.container_diameter_mm), butt_mm: Number(p.butt_mm), runout_m: Number(p.runout_m), front_crop_m: Number(p.front_crop_m), back_crop_m: Number(p.back_crop_m), step_mm: Number(p.step_mm) }));
  return { data: { inputs: { ...inputs, presses }, plans: presses.length ? presses.map(press => ({ press, plan: planBilletLength(job, press) })) : [{ press: null as never, plan: planBilletLength(job, null) }] } };
}

export async function billetOptionsAction(jobId: string): Promise<Result<BilletOptions>> {
  try {
    await allowed(BILLET_READERS);
    const read = await readOptions(z.string().uuid().parse(jobId));
    return read.data ? { success: true, data: read.data } : { success: false, error: read.error ?? "Options are unavailable." };
  } catch { return { success: false, error: "Billet options could not be calculated. Check your session and retry." }; }
}

export async function chooseBilletLengthAction(input: { jobId: string; machineId: string; chosenMm: number }): Promise<Result<{ chosen_mm: number }>> {
  try {
    await allowed(BILLET_PLANNERS);
    const v = z.object({ jobId: z.string().uuid(), machineId: z.string().uuid(), chosenMm: z.number().positive().max(3000) }).parse(input);
    const read = await readOptions(v.jobId);
    if (!read.data) return { success: false, error: read.error ?? "Options are unavailable." };
    const entry = read.data.plans.find(p => p.press?.machine_id === v.machineId);
    if (!entry || !entry.plan.ok) return { success: false, error: "This press has no calculated options. Complete its billet limits and the job inputs." };
    const plan = entry.plan;
    const chosen = plan.options.find((o: BilletOption) => o.billet_mm === v.chosenMm);
    if (!chosen) return { success: false, error: "Choose one of the listed lengths." };
    const supabase = await createClient();
    const saved = await supabase.rpc("ap_billet_length", { p_command: "record_choice", p_payload: { job_id: v.jobId, machine_id: v.machineId, chosen_mm: chosen.billet_mm,
      recommended_mm: plan.recommended.billet_mm, ...(plan.standard ? { standard_mm: plan.standard.billet_mm, standard_recovery: plan.standard.recovery_percent } : {}),
      chosen_recovery: chosen.recovery_percent, recommended_recovery: plan.recommended.recovery_percent, options: plan.options, inputs_fingerprint: read.data.inputs.fingerprint } });
    if (saved.error) return { success: false, error: dbMessage(saved.error, "The choice could not be recorded.") };
    refresh(`/production/${v.jobId}`);
    return { success: true, data: { chosen_mm: chosen.billet_mm } };
  } catch { return { success: false, error: "The choice could not be recorded. Check your session and retry." }; }
}
