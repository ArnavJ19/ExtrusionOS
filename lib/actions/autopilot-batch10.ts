"use server";

// Autopilot batch 10 server actions that compute something before the database records it: AP-055 sequences the powder
// coating queue into runs by shade, AP-067 works out one push pattern for several jobs of a die, and AP-070 turns a
// configurator project's cutting list into order lines. Each one reads its inputs through the gateway as the signed-in
// person, computes with the library function, and writes only through the gateway, which re-checks the company, the
// actor, the role and that the inputs have not changed.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { COATING_LEADS, COATING_ROLES, CUT_PLANNERS, SYSTEM_ORDER_ROLES, coatingConfirmSchema, cutPrepareSchema } from "@/lib/autopilot-batch10/commands";
import { planCoatingRuns, type CoatingJob, type CoatingPlan, type CoatingSettings } from "@/lib/workflow/coating-batches";
import { compareCutPlans, usableLengthPerPush, type CutComparison } from "@/lib/calculations/cut-combination";
import { buildSystemOrderLines, hardwareNote, type SystemCut, type SystemOrderLine, type SystemProfileInfo } from "@/lib/systems-configurator/order-lines";

type Result<T> = { success: true; data: T } | { success: false; error: string };
const message = (error: { code?: string; message?: string } | null) => error?.code === "P0001" && error.message?.startsWith("AP: ") ? error.message.slice(4)
  : error?.code === "42501" ? "This action is not available to your role."
  : ["PGRST202", "42883", "42P01"].includes(error?.code ?? "") ? "This needs the Autopilot batch 10 database upgrade." : "The request could not be completed. Retry in a moment.";
function refresh(path: string) { try { revalidatePath(path); } catch { /* the database outcome stands */ } }
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// ---------------------------------------------------------------- AP-055
type CoatingQueue = { rows: CoatingJob[]; fingerprint: string; today: string; can_confirm: boolean; settings: CoatingSettings | null; working_days: string[];
  confirmed: { id: string; run_day: string; groups: unknown[]; shade_changes: number; baseline_changes: number; breaches: unknown[]; breach_note: string | null; confirmed_by: string | null; confirmed_at: string; stale: boolean } | null };
export type CoatingView = { plan: CoatingPlan; fingerprint: string; today: string; can_confirm: boolean; settings: CoatingSettings | null; working_days: string[]; confirmed: CoatingQueue["confirmed"] };

const planInput = z.object({ run_day: day.optional(), order: z.array(z.string().min(1).max(160)).max(200).optional() }).strict();

/** AP-055: the waiting powder-coating jobs grouped by shade and brand, in run order, with the promised dates the order would miss. */
export async function coatingPlanAction(input: z.infer<typeof planInput> = {}): Promise<Result<CoatingView>> {
  try {
    const ctx = await getSessionContext();
    if (ctx.dealerId || !(COATING_ROLES as readonly string[]).includes(ctx.role)) return { success: false, error: "The coating queue is for production and finishing." };
    const parsed = planInput.safeParse(input);
    if (!parsed.success) return { success: false, error: "Review the run order." };
    const supabase = await createClient();
    const read = await supabase.rpc("ap_coating", { p_command: "queue", p_payload: {} });
    if (read.error) return { success: false, error: message(read.error) };
    const q = read.data as CoatingQueue;
    const runDay = parsed.data.run_day && parsed.data.run_day >= q.today ? parsed.data.run_day : q.working_days[0] ?? q.today;
    const plan = planCoatingRuns(q.rows.map(row => ({ ...row, kg: row.kg === null || row.kg === undefined ? null : Number(row.kg) })), { runDay, settings: normaliseSettings(q.settings), workingDays: q.working_days, order: parsed.data.order });
    return { success: true, data: { plan, fingerprint: q.fingerprint, today: q.today, can_confirm: q.can_confirm, settings: normaliseSettings(q.settings), working_days: q.working_days, confirmed: q.confirmed } };
  } catch {
    return { success: false, error: "The coating queue could not be read. Check your session and retry." };
  }
}
function normaliseSettings(s: CoatingSettings | null): CoatingSettings | null {
  return s ? { capacity_kg_per_hour: Number(s.capacity_kg_per_hour), changeover_minutes: Number(s.changeover_minutes), day_start: String(s.day_start), hours_per_day: Number(s.hours_per_day) } : null;
}

/** AP-055: the supervisor confirms the run order. The order is sequenced again from the queue as it is now; a changed queue is refused. */
export async function confirmCoatingRunAction(input: z.infer<typeof coatingConfirmSchema>): Promise<Result<{ id: string; run_day: string; shade_changes: number; baseline_changes: number; jobs: number }>> {
  try {
    const ctx = await getSessionContext();
    if (ctx.dealerId || !(COATING_LEADS as readonly string[]).includes(ctx.role)) return { success: false, error: "The run order is confirmed by the finishing supervisor or a production manager." };
    const parsed = coatingConfirmSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Review the run order." };
    const v = parsed.data;
    const supabase = await createClient();
    const read = await supabase.rpc("ap_coating", { p_command: "queue", p_payload: {} });
    if (read.error) return { success: false, error: message(read.error) };
    const q = read.data as CoatingQueue;
    if (q.fingerprint !== v.fingerprint) return { success: false, error: "The coating queue changed since this order was prepared. Reload and review it again." };
    if (!q.rows.length) return { success: false, error: "Nothing is waiting for powder coating." };
    const plan = planCoatingRuns(q.rows.map(row => ({ ...row, kg: row.kg === null || row.kg === undefined ? null : Number(row.kg) })), { runDay: v.run_day, settings: normaliseSettings(q.settings), workingDays: q.working_days, order: v.order });
    if (plan.breaches.length && !v.breach_note) return { success: false, error: `${plan.breaches.length} job(s) would finish after the promised date in this order. Give the reason before confirming.` };
    const out = await supabase.rpc("ap_coating", { p_command: "confirm", p_payload: {
      run_day: v.run_day, fingerprint: q.fingerprint, shade_changes: plan.shade_changes, baseline_changes: plan.baseline_changes, total_kg: plan.total_kg,
      groups: plan.groups.map((g, index) => ({ seq: index + 1, key: g.key, shade_key: g.shade_key, shade: g.shade, brand: g.brand, job_ids: g.job_ids, kg: g.kg, unweighed_jobs: g.unweighed_jobs, start_day: g.start_day, finish_day: g.finish_day,
        orders: g.jobs.map(j => j.order_number).filter(Boolean) })),
      breaches: plan.breaches, ...(plan.breaches.length && v.breach_note ? { breach_note: v.breach_note } : {}) } });
    if (out.error) return { success: false, error: message(out.error) };
    refresh("/production/finishing/coating-runs");
    return { success: true, data: out.data as { id: string; run_day: string; shade_changes: number; baseline_changes: number; jobs: number } };
  } catch {
    return { success: false, error: "The run order could not be confirmed. Check your session and retry." };
  }
}

// ---------------------------------------------------------------- AP-067
type CutInputs = {
  die_id: string; die_number: string; profile_code: string; kg_per_m: number | null; billet_diameter_mm: number | null; machine_id: string | null; machine_name: string | null; fingerprint: string;
  jobs: { job_id: string; job_number: string | null; order_number: string | null; cut_length_m: number; pieces: number }[];
  press: { min_billet_mm: number; max_billet_mm: number; standard_billet_mm: number | null; butt_mm: number; runout_m: number; front_crop_m: number; back_crop_m: number } | null;
  standard: { version: number; saw_kerf_mm: number; density_kg_m3: number } | null;
};
export type CutPrepared = { recorded: boolean; id: string | null; comparison: Extract<CutComparison, { ok: true }>; billet_mm: number; kerf_basis: string; message: string };

/**
 * AP-067: one push pattern for the chosen jobs of a die. The usable length per push comes from the press's billet and
 * run-out settings and the section weight; the saw kerf from the approved scrap standard. The pattern is recorded as a
 * proposal only when it saves at least one push; the planner then accepts it. Jobs, quantities and cut lengths are not changed.
 */
export async function prepareCutCombinationAction(input: z.infer<typeof cutPrepareSchema>): Promise<Result<CutPrepared>> {
  try {
    const ctx = await getSessionContext();
    if (ctx.dealerId || !(CUT_PLANNERS as readonly string[]).includes(ctx.role)) return { success: false, error: "Combined cut patterns are prepared by planning." };
    const parsed = cutPrepareSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Choose the jobs to combine." };
    const v = parsed.data;
    const supabase = await createClient();
    const read = await supabase.rpc("ap_cut_combine", { p_command: "inputs", p_payload: { die_id: v.die_id, job_ids: v.job_ids, ...(v.machine_id ? { machine_id: v.machine_id } : {}) } });
    if (read.error) return { success: false, error: message(read.error) };
    const inputs = read.data as CutInputs;
    if (inputs.fingerprint !== v.fingerprint) return { success: false, error: "The jobs or the press settings changed since you opened this die. Reload and choose again." };
    if (inputs.jobs.length !== v.job_ids.length) return { success: false, error: "A chosen job is no longer waiting on this die." };
    if (!inputs.machine_id || !inputs.press) return { success: false, error: "Choose the press, and set its billet and run-out settings (Production → Billet length) first." };
    const billet = v.billet_mm ?? inputs.press.standard_billet_mm ?? inputs.press.max_billet_mm;
    if (billet < Number(inputs.press.min_billet_mm) || billet > Number(inputs.press.max_billet_mm)) return { success: false, error: `The billet length must be within the press limits (${inputs.press.min_billet_mm}–${inputs.press.max_billet_mm} mm).` };
    const usable = usableLengthPerPush({ billet_mm: Number(billet), billet_diameter_mm: inputs.billet_diameter_mm === null ? null : Number(inputs.billet_diameter_mm), butt_mm: Number(inputs.press.butt_mm),
      kg_per_m: inputs.kg_per_m === null ? null : Number(inputs.kg_per_m), runout_m: Number(inputs.press.runout_m), front_crop_m: Number(inputs.press.front_crop_m), back_crop_m: Number(inputs.press.back_crop_m),
      density_kg_m3: inputs.standard ? Number(inputs.standard.density_kg_m3) : null });
    if (usable === null) return { success: false, error: "The usable length per push cannot be worked out: the profile needs a section weight and a billet diameter." };
    const kerf = inputs.standard ? Number(inputs.standard.saw_kerf_mm) : 5;
    const comparison = compareCutPlans(inputs.jobs.map(j => ({ job_id: j.job_id, length_m: Number(j.cut_length_m), pieces: Number(j.pieces) })), usable, kerf);
    if (!comparison.ok) return { success: false, error: comparison.error };
    const kerfBasis = inputs.standard ? `approved scrap standard v${inputs.standard.version}` : "5 mm assumed (no approved scrap standard for this press and die)";
    if (!comparison.improves) {
      return { success: true, data: { recorded: false, id: null, comparison, billet_mm: Number(billet), kerf_basis: kerfBasis, message: "Combining these jobs does not save a push. Plan them separately." } };
    }
    const out = await supabase.rpc("ap_cut_combine", { p_command: "record", p_payload: { die_id: v.die_id, machine_id: inputs.machine_id, job_ids: v.job_ids, fingerprint: inputs.fingerprint,
      usable_m: usable, kerf_mm: kerf, billet_mm: Number(billet), patterns: comparison.combined.patterns, separate_pushes: comparison.separate.pushes, combined_pushes: comparison.combined.pushes,
      separate_recovery: comparison.separate.recovery_percent, combined_recovery: comparison.combined.recovery_percent } });
    if (out.error) return { success: false, error: message(out.error) };
    refresh("/production/cutting/combine");
    return { success: true, data: { recorded: true, id: (out.data as { id: string }).id, comparison, billet_mm: Number(billet), kerf_basis: kerfBasis,
      message: `Combined pattern prepared: ${comparison.combined.pushes} pushes instead of ${comparison.separate.pushes}.` } };
  } catch {
    return { success: false, error: "The pattern could not be prepared. Check your session and retry." };
  }
}

// ---------------------------------------------------------------- AP-070
export type SystemOrderPrefill = {
  configuration_id: string; number: string | null; project_name: string | null; finish: string;
  customer: { id: string; customer_name: string; company_name: string | null };
  lines: SystemOrderLine[]; skipped: { profile_code: string; reason: string }[]; notes: string;
  hardware: { item_code: string; item_name: string; category: string; quantity: number; unit: string }[];
};
const FINISHES = ["mill_finish", "powder_coating", "anodizing", "anodized_silver", "anodized_bronze", "anodized_black", "wood_finish", "wood_grain", "pvdf", "other"];

/** AP-070: the configurator project's cutting list as order lines of stock lengths, with the free stock of each. Nothing is saved. */
export async function systemOrderDraftAction(configurationId: string): Promise<Result<SystemOrderPrefill>> {
  try {
    const ctx = await getSessionContext();
    if (ctx.dealerId || !(SYSTEM_ORDER_ROLES as readonly string[]).includes(ctx.role)) return { success: false, error: "Orders from configurator projects are prepared by sales." };
    const id = z.string().uuid().safeParse(configurationId);
    if (!id.success) return { success: false, error: "Configurator project not found." };
    const supabase = await createClient();
    const read = await supabase.rpc("ap_systems_order", { p_command: "draft", p_payload: { configuration_id: id.data } });
    if (read.error) return { success: false, error: message(read.error) };
    const d = read.data as { configuration: { id: string; number: string | null; project_name: string | null; finish_type: string | null };
      customer: { id: string; customer_name: string; company_name: string | null } | null; cuts: SystemCut[]; profiles: Record<string, SystemProfileInfo>;
      hardware: SystemOrderPrefill["hardware"]; materials: { material_type: string; item_code: string | null; item_name: string; quantity: number; unit: string }[] };
    if (!d.customer) return { success: false, error: "Choose the customer on the project first." };
    const finish = FINISHES.includes(String(d.configuration.finish_type ?? "")) ? String(d.configuration.finish_type) : "mill_finish";
    const cuts = d.cuts.map(c => ({ ...c, cut_length_mm: Number(c.cut_length_mm), quantity: Number(c.quantity), stock_length_mm: Number(c.stock_length_mm), kg_per_m: c.kg_per_m === null ? null : Number(c.kg_per_m) }));
    const profiles = Object.fromEntries(Object.entries(d.profiles).map(([key, p]) => [key, { ...p, section_weight_kg_per_m: p.section_weight_kg_per_m === null ? null : Number(p.section_weight_kg_per_m),
      free: { pieces: Number(p.free.pieces), kg: Number(p.free.kg), lots: p.free.lots.map(l => ({ ...l, piece_length_m: l.piece_length_m === null ? null : Number(l.piece_length_m), pieces: Number(l.pieces), kg: Number(l.kg) })) } }]));
    const built = buildSystemOrderLines(cuts, profiles, finish);
    if (!built.lines.length) return { success: false, error: "No profile on this project's cutting list is linked to the catalogue, so there is nothing to order." };
    if (built.lines.length > 100) return { success: false, error: "This project needs more than 100 order lines. Split it into separate projects." };
    return { success: true, data: { configuration_id: d.configuration.id, number: d.configuration.number, project_name: d.configuration.project_name, finish, customer: d.customer,
      lines: built.lines, skipped: built.skipped, hardware: d.hardware.map(h => ({ ...h, quantity: Number(h.quantity) })),
      notes: hardwareNote({ number: d.configuration.number, project_name: d.configuration.project_name }, d.hardware.map(h => ({ ...h, quantity: Number(h.quantity) })), d.materials.map(m => ({ ...m, quantity: Number(m.quantity) }))) } };
  } catch {
    return { success: false, error: "The project could not be opened as an order. Check your session and retry." };
  }
}

const linkSchema = z.object({ configuration_id: z.string().uuid(), order_id: z.string().uuid(),
  lines: z.array(z.object({ profile_code: z.string().max(80), stock_length_m: z.number().positive(), pieces: z.number().int().positive(), free_pieces: z.number().int().min(0) }).strict()).max(100) }).strict();

/** AP-070: after the order was saved through the normal order entry, the project records it. */
export async function linkSystemOrderAction(input: z.infer<typeof linkSchema>): Promise<Result<{ order_number: string; configuration_updated: boolean }>> {
  try {
    const ctx = await getSessionContext();
    if (ctx.dealerId || !(SYSTEM_ORDER_ROLES as readonly string[]).includes(ctx.role)) return { success: false, error: "Not available." };
    const parsed = linkSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: "The order was saved, but the project could not be linked to it." };
    const supabase = await createClient();
    const out = await supabase.rpc("ap_systems_order", { p_command: "link", p_payload: parsed.data });
    if (out.error) return { success: false, error: message(out.error) };
    refresh(`/systems-configurator/projects/${parsed.data.configuration_id}`);
    return { success: true, data: out.data as { order_number: string; configuration_updated: boolean } };
  } catch {
    return { success: false, error: "The order was saved, but the project could not be linked to it." };
  }
}
