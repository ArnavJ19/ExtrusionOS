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
  ap_press: pressCommands, ap_scrap: scrapCommands, ap_dies: dieCommands, ap_pm: pmCommands, ap_sampling: samplingCommands
};
const READS = new Set(["read", "add_working_days", "list", "get", "overview", "runs", "layout", "usage", "pending_count", "flags", "record", "attention", "visit",
  "station", "push", "undo", "job", "expected", "cycle_times", "floor", "downtime", "die_changes", "settings", "reconcile", "service", "options", "plans", "compliance",
  "triggers", "samples", "sample", "queue"]);
const REVALIDATE: Record<string, string[]> = {
  ap_calendar: ["/production/calendar"], ap_series: ["/settings/numbering"], ap_proposals: ["/dashboard", "/settings/navigation", "/settings/numbering", "/invoices/periods", "/production", "/production/floor", "/dies", "/maintenance"],
  ap_jobs: ["/automation"], ap_navigation: ["/settings/navigation"], ap_period: ["/invoices/periods"], ap_import: ["/settings/data/import"],
  ap_cutover: ["/settings/data/cutover"], ap_home_work: [],
  ap_press: ["/production/floor"], ap_scrap: ["/production/scrap-standards"], ap_dies: ["/dies"], ap_pm: ["/maintenance"], ap_sampling: ["/quality/samples"]
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
