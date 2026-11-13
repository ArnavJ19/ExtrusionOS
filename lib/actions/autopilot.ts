"use server";

// Autopilot gateway (batches 1 and 2). Every command is allow-listed and validated here, then re-checked by the database
// function, which takes the company and the actor from the session. Only messages the database marks with "AP: "
// (and the accounting-lock and GSTIN messages, which name the rule) are shown to people.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { calendarExceptionInputSchema, calendarSettingsSchema } from "@/lib/calendar/working-time";
import { cutoverCommandSchemas } from "@/lib/cutover/cutover";
import { JOB_KEYS } from "@/lib/jobs/registry";
import { HOME_KIND_KEYS } from "@/lib/navigation/home-work";
import { NAV_ROLES, navigationSaveSchema } from "@/lib/navigation/role-navigation";
import { seriesConfirmSchema } from "@/lib/numbering/financial-year";
import { periodCommandSchemas } from "@/lib/periods/periods";
import { PROPOSAL_TYPE_KEYS, decideBatchInputSchema, decideInputSchema } from "@/lib/proposals/proposals";
import { dieCommands, pmCommands, pressCommands, samplingCommands, scrapCommands } from "@/lib/press/press-floor";
import { CASH_READS, billingCommands, cashCommands, creditCommands, dupeCommands, jobDraftCommands, quoteCommands } from "@/lib/order-to-cash/commands";
import { DISPATCH_READS, dispatchCommands, ewayCommands, freightCommands, shareCommands, tallyCommands } from "@/lib/dispatch-autopilot/commands";
import { BATCH5_READS, finishingCommands, quoteSalesCommands, usualCommands } from "@/lib/autopilot-batch5/commands";
import { OPERATIONS_READS, accountsCommands, digestCommands, planningCommands, stockCommands } from "@/lib/autopilot-batch5/operations";
import { BATCH6_READS, billetLengthCommands, einvoiceCommands, healthCommands, ncrCommands, offlineCommands, pressPlanCommands, reorderCommands, repriceCommands, tdsCommands, weightCommands } from "@/lib/autopilot-batch6/commands";

export type ApResult<T = unknown> = { success: true; data: T } | { success: false; error: string; unavailable?: boolean };

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const page = z.number().int().min(1).max(100000).optional();
const id = z.object({ id: z.string().uuid() }).strict();
const batch = z.object({ batch_id: z.string().uuid() }).strict();

const COMMANDS: Record<string, Record<string, z.ZodTypeAny>> = {
  ap_calendar: {
    read: z.object({ from: day.optional(), to: day.optional() }).strict(),
    add_working_days: z.object({ start: day, days: z.number().int().min(0).max(730) }).strict(),
    save_settings: calendarSettingsSchema, add_exception: calendarExceptionInputSchema, remove_exception: id
  },
  ap_series: { list: z.object({}).strict(), confirm: seriesConfirmSchema },
  ap_proposals: {
    list: z.object({ status: z.enum(["open", "decided", "all"]).optional(), type: z.enum(PROPOSAL_TYPE_KEYS).optional(), page,
      target: z.string().min(1).max(80).optional(), target_prefix: z.string().regex(/^[0-9a-f-]{36}:?$/).optional() }).strict(),
    decide: decideInputSchema, decide_batch: decideBatchInputSchema, pending_count: z.object({}).strict()
  },
  ap_jobs: {
    overview: z.object({}).strict(),
    runs: z.object({ page, job_key: z.enum(JOB_KEYS).optional(), status: z.enum(["running", "succeeded", "failed"]).optional() }).strict(),
    run_now: z.object({ job_key: z.enum(JOB_KEYS) }).strict()
  },
  ap_navigation: {
    visit: z.object({ route: z.string().max(80) }).strict(), layout: z.object({}).strict(), usage: z.object({}).strict(),
    save: navigationSaveSchema, reset: z.object({ role: z.enum(NAV_ROLES) }).strict()
  },
  ap_period: periodCommandSchemas,
  ap_import: {
    list: z.object({ page, master: z.enum(["customers", "vendors", "transporters", "profiles", "dies", "machines"]).optional() }).strict(),
    get: batch, commit: batch, discard: batch,
    reverse: z.object({ batch_id: z.string().uuid(), reason: z.string().trim().min(10, "Give a reason of at least 10 characters").max(300) }).strict()
  },
  ap_cutover: cutoverCommandSchemas,
  ap_home_work: {
    record: z.object({ kind: z.enum(HOME_KIND_KEYS), id: z.string().uuid() }).strict(),
    attention: z.object({ limit: z.number().int().min(1).max(20).optional() }).strict()
  },
  // Batch 2: press floor capture.
  ap_press: pressCommands, ap_scrap: scrapCommands, ap_dies: dieCommands, ap_pm: pmCommands, ap_sampling: samplingCommands,
  // Batch 3: order-to-cash.
  ap_credit: creditCommands, ap_jobdrafts: jobDraftCommands, ap_billing: billingCommands, ap_cash: cashCommands, ap_quotes: quoteCommands, ap_dupes: dupeCommands,
  // Batch 4: dispatch and compliance (file exports go through lib/actions/dispatch-autopilot, which builds the file first).
  ap_dispatch: dispatchCommands, ap_freight: freightCommands, ap_eway: ewayCommands, ap_tally: tallyCommands, ap_share: shareCommands,
  // Batch 5: usual choices, finishing vendor chase, quotation follow-ups and floor prices.
  ap_usual: usualCommands, ap_finishing: finishingCommands, ap_quote_sales: quoteSalesCommands,
  ap_stock: stockCommands, ap_planning: planningCommands, ap_accounts: accountsCommands, ap_digest: digestCommands,
  // Batch 6: weight drift, repricing, system health, reorder points, NCRs, TDS, e-invoice, billet length, offline queue and press plan drafts.
  // E-invoice export/import, TDS statement import and the billet length choice go through lib/actions/autopilot-batch6, which builds or computes first.
  ap_weight: weightCommands, ap_reprice: repriceCommands, ap_health: healthCommands, ap_reorder: reorderCommands, ap_ncr: ncrCommands, ap_tds: tdsCommands,
  ap_einvoice: einvoiceCommands, ap_billet_length: billetLengthCommands, ap_offline: offlineCommands, ap_press_plan: pressPlanCommands
};
const READS = new Set(["read", "add_working_days", "list", "get", "overview", "runs", "layout", "usage", "pending_count", "flags", "record", "attention", "visit",
  "station", "push", "undo", "job", "expected", "cycle_times", "floor", "downtime", "die_changes", "settings", "reconcile", "service", "options", "plans", "compliance",
  "triggers", "samples", "sample", "queue", ...CASH_READS, ...DISPATCH_READS, ...BATCH5_READS, ...OPERATIONS_READS, ...BATCH6_READS]);
const REVALIDATE: Record<string, string[]> = {
  ap_calendar: ["/production/calendar"], ap_series: ["/settings/numbering"], ap_proposals: ["/dashboard", "/settings/navigation", "/settings/numbering", "/invoices/periods", "/production", "/production/floor", "/dies", "/maintenance"],
  ap_jobs: ["/automation"], ap_navigation: ["/settings/navigation"], ap_period: ["/invoices/periods"], ap_import: ["/settings/data/import"],
  ap_cutover: ["/settings/data/cutover"], ap_home_work: [],
  ap_press: ["/production/floor"], ap_scrap: ["/production/scrap-standards"], ap_dies: ["/dies"], ap_pm: ["/maintenance"], ap_sampling: ["/quality/samples"],
  ap_credit: ["/orders/credit", "/orders"], ap_jobdrafts: ["/production/drafts", "/production"], ap_billing: ["/invoices/drafts", "/invoices/tax-rules", "/invoices"],
  ap_cash: ["/payments/bank", "/payments/reminders", "/payments/receipts", "/payments"], ap_quotes: ["/quotes"], ap_dupes: [],
  ap_dispatch: ["/dispatches", "/dispatches/loading", "/dispatches/gate", "/dispatches/labels", "/dispatches/ready", "/dispatches/packing"], ap_freight: ["/dispatches/freight"],
  ap_eway: ["/dispatches/eway"], ap_tally: ["/invoices/tally"], ap_share: [],
  ap_usual: [], ap_finishing: ["/production/finishing/chase"], ap_quote_sales: ["/quotes", "/quotes/followups", "/quotes/floors"],
  ap_stock: ["/inventory", "/inventory/movements"], ap_planning: ["/production/billet-forecast", "/orders/at-risk", "/dashboard"],
  ap_accounts: ["/invoices/periods", "/payments/msme"], ap_digest: ["/dashboard"],
  ap_weight: ["/dies", "/dies/weight-drift"], ap_reprice: ["/quotes", "/quotes/reprice"], ap_health: [], ap_reorder: ["/inventory/reorder", "/inventory"],
  ap_ncr: ["/quality", "/quality/ncrs"], ap_tds: ["/payments/tds", "/payments", "/invoices"], ap_einvoice: ["/invoices/einvoice"], ap_billet_length: ["/production"],
  ap_offline: ["/mobile", "/production/floor"], ap_press_plan: ["/production/schedule", "/production/schedule/draft"]
};

function friendly(error: { code?: string; message?: string } | null | undefined): ApResult<never> {
  const code = error?.code ?? "", message = error?.message ?? "";
  if (["PGRST202", "42883", "42P01"].includes(code)) return { success: false, unavailable: true, error: "This needs the Autopilot database upgrade. Existing workflows remain available." };
  if (code === "42501") return { success: false, error: "This record or action is not available to your current session." };
  if (code === "P0001" && message.startsWith("AP: ")) return { success: false, error: message.slice(4) };
  if (code === "23514" && /^(Books are closed|GSTIN|Enter the GSTIN|A party marked|AP: |Billet mass balance)/.test(message)) return { success: false, error: message.replace(/^AP: /, "") };
  if (["23505", "23514", "23503", "22P02", "22007", "22008", "22003"].includes(code)) return { success: false, error: "The details conflict with current records. Reload and review again." };
  return { success: false, error: "The request could not be completed. Check your connection and retry." };
}

export async function autopilotAction(rpc: string, command: string, payload: unknown = {}): Promise<ApResult> {
  try {
    const schema = COMMANDS[rpc]?.[command];
    if (!schema) return { success: false, error: "Unknown request." };
    const parsed = schema.safeParse(payload ?? {});
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Review the details." };
    if (rpc === "ap_offline" && command === "submit") {
      // AP-094: the queued entry is validated as the command it carries; the database then runs that command once.
      const entry = parsed.data as { rpc: string; command: string; payload: unknown };
      const inner = COMMANDS[entry.rpc]?.[entry.command]?.safeParse(entry.payload);
      if (!inner?.success) return { success: false, error: inner?.error.issues[0]?.message ?? "This entry cannot be sent." };
      (parsed.data as { payload: unknown }).payload = inner.data;
    }
    const context = await getSessionContext();
    if (context.dealerId || ["dealer_admin", "dealer_staff"].includes(context.role)) return { success: false, error: "This action is not permitted for your current session." };
    const supabase = await createClient();
    const result = await supabase.rpc(rpc, { p_command: command, p_payload: parsed.data });
    if (result.error) return friendly(result.error);
    if (!READS.has(command)) for (const path of REVALIDATE[rpc] ?? []) { try { revalidatePath(path); } catch { /* the database outcome stands */ } }
    return { success: true, data: result.data };
  } catch {
    return { success: false, error: "The request could not be completed. Check your session and retry." };
  }
}
