// AP-043: one die module. The health table that lived on /die-intelligence and the overview's attention list are loaded
// here (the same queries and the same RLS as before; no table changes). Health falls back to the die status when no
// metrics row exists. Die cost and cost per kg are shown only to the roles that could open Die Intelligence.
import type { createClient } from "@/lib/supabase/server";
import { getBusinessDateBoundaries } from "@/lib/utils/business-date";
import { getErrorMessage } from "@/lib/utils/errors";

type Client = Awaited<ReturnType<typeof createClient>>;
export type DieHealthRow = Record<string, any>;

/** Roles that see die health with die cost and cost per kg (the former Die Intelligence audience). */
export const DIE_HEALTH_ROLES = ["owner", "admin", "production_manager", "quality"] as const;
/** Recovery below this (or the profile's own minimum) with three or more runs puts a die on the attention list. */
export const POOR_RECOVERY_PERCENT = 80;

export function healthFromStatus(status: string | null) {
  if (status === "dead") return 0;
  if (status === "inactive") return 25;
  if (status === "correction") return 45;
  if (status === "trial" || status === "nitriding") return 70;
  return 85;
}

export function recommendationFromStatus(status: string | null) {
  if (status === "dead") return "dead";
  if (status === "inactive") return "replace_soon";
  if (status === "correction") return "correction_needed";
  if (status === "trial" || status === "nitriding") return "monitor";
  return "healthy";
}

export async function loadDieHealth(supabase: Client, companyId: string) {
  const [diesResult, metricsResult, trialsResult, correctionsResult, nitridingDueResult] = await Promise.all([
    supabase.from("dies")
      .select("id, die_number, die_code, die_status, die_type, ownership_type, performance_grade, total_production_kg, total_runs, last_used_date, die_manufacturer, die_cost, correction_history, average_recovery_percent, die_diameter_mm, number_of_cavities, priority_level, profile_id, customer_id, aluminium_profiles!dies_profile_id_fkey(profile_code, profile_name), customers(customer_name, company_name)")
      .eq("company_id", companyId).order("die_number", { ascending: true }),
    supabase.from("die_health_metrics").select("*").eq("company_id", companyId),
    supabase.from("die_trials").select("*").eq("company_id", companyId).order("trial_date", { ascending: false }).limit(200),
    supabase.from("die_corrections").select("*").eq("company_id", companyId).order("correction_date", { ascending: false }).limit(200),
    supabase.from("die_nitriding_history").select("die_id, next_nitriding_due_date").eq("company_id", companyId).not("next_nitriding_due_date", "is", null).order("nitriding_date", { ascending: false }).limit(200),
  ]);
  const metricsByDieId = new Map((metricsResult.data ?? []).map((metric: any) => [metric.die_id, metric]));
  const trialCounts = new Map<string, number>(); const correctionCounts = new Map<string, number>(); const nitridingDueByDie = new Map<string, string>();
  for (const trial of trialsResult.data ?? []) trialCounts.set(trial.die_id, (trialCounts.get(trial.die_id) ?? 0) + 1);
  for (const correction of correctionsResult.data ?? []) correctionCounts.set(correction.die_id, (correctionCounts.get(correction.die_id) ?? 0) + 1);
  for (const n of nitridingDueResult.data ?? []) if (!nitridingDueByDie.has(n.die_id)) nitridingDueByDie.set(n.die_id, n.next_nitriding_due_date);
  const { today } = getBusinessDateBoundaries();
  const dies: DieHealthRow[] = (diesResult.data ?? []).map((die: any) => {
    const metric = metricsByDieId.get(die.id) as any | undefined;
    const profile = die.aluminium_profiles as any; const customer = die.customers as any;
    const nitridingDue = nitridingDueByDie.get(die.id);
    return {
      ...die,
      profile_name: profile?.profile_name ?? profile?.profile_code ?? "Unlinked profile",
      customer_name: customer?.company_name ?? customer?.customer_name ?? "Company owned",
      health_score: Number(metric?.health_score ?? healthFromStatus(die.die_status)),
      recommendation: metric?.recommendation ?? recommendationFromStatus(die.die_status),
      total_rejection_kg: Number(metric?.total_rejection_kg ?? 0),
      rejection_rate: Number(metric?.rejection_rate ?? 0),
      correction_count: Number(metric?.correction_count ?? correctionCounts.get(die.id) ?? 0),
      trial_count: Number(metric?.trial_count ?? trialCounts.get(die.id) ?? 0),
      average_recovery_percent: Number(die.average_recovery_percent ?? metric?.average_recovery_percent ?? 0),
      cost_per_kg: Number(metric?.cost_per_kg ?? (Number(die.total_production_kg ?? 0) > 0 ? Number(die.die_cost ?? 0) / Number(die.total_production_kg ?? 1) : 0)),
      last_correction_date: metric?.last_correction_date ?? null,
      last_trial_date: metric?.last_trial_date ?? null,
      nitriding_due: nitridingDue ?? null,
      nitriding_overdue: nitridingDue ? nitridingDue <= today : false,
      performance_grade: die.performance_grade ?? "good",
    };
  });
  const errors = [diesResult, metricsResult, trialsResult, correctionsResult, nitridingDueResult].map(result => result.error ? getErrorMessage(result.error) : "").filter(Boolean);
  return { dies, trials: trialsResult.data ?? [], corrections: correctionsResult.data ?? [], errors };
}

export type DieAttentionItem = { die_id: string; die_number: string; detail: string; tone: "warning" | "info" };
export type DieAttention = { nitriding: DieAttentionItem[]; away: DieAttentionItem[]; recovery: DieAttentionItem[]; drift: DieAttentionItem[]; errors: string[] };

const shortDay = (iso: string | null) => iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" }) : null;

/** Recovery attention rule, shared by the overview and its tests. Unknown recovery is never "poor". */
export function poorRecovery(die: { average_recovery_percent: unknown; total_runs: unknown; min_acceptable?: unknown }) {
  const recovery = die.average_recovery_percent === null || die.average_recovery_percent === undefined || die.average_recovery_percent === "" ? null : Number(die.average_recovery_percent);
  const runs = Number(die.total_runs ?? 0);
  const floor = die.min_acceptable === null || die.min_acceptable === undefined || die.min_acceptable === "" ? POOR_RECOVERY_PERCENT : Number(die.min_acceptable);
  return recovery !== null && Number.isFinite(recovery) && recovery > 0 && runs >= 3 && recovery < floor;
}

/** What needs attention on dies right now: nitriding due, away from the plant, poor recovery, section-weight drift. Ten each. */
export async function loadDieAttention(supabase: Client, companyId: string): Promise<DieAttention> {
  const { today } = getBusinessDateBoundaries();
  const soon = new Date(`${today}T00:00:00Z`); soon.setUTCDate(soon.getUTCDate() + 7);
  const [nitriding, dies, away, drift] = await Promise.all([
    supabase.from("die_nitriding_history").select("die_id, next_nitriding_due_date, nitriding_date, dies(die_number, die_status)").eq("company_id", companyId)
      .not("next_nitriding_due_date", "is", null).order("nitriding_date", { ascending: false }).limit(300),
    supabase.from("dies").select("id, die_number, average_recovery_percent, total_runs, die_status, aluminium_profiles!dies_profile_id_fkey(min_acceptable_recovery_percent)").eq("company_id", companyId)
      .not("average_recovery_percent", "is", null).order("average_recovery_percent", { ascending: true }).limit(60),
    supabase.rpc("ap_die_window", { p_command: "away", p_payload: { page: 1 } }),
    supabase.rpc("ap_proposals", { p_command: "list", p_payload: { status: "open", type: "die.weight_drift", page: 1 } })
  ]);
  const errors: string[] = [];
  const latest = new Map<string, any>();
  for (const row of nitriding.data ?? []) if (!latest.has(row.die_id)) latest.set(row.die_id, row);
  const nitridingItems = [...latest.values()].filter(r => r.next_nitriding_due_date <= soon.toISOString().slice(0, 10) && !["retired", "scrapped", "dead"].includes((r.dies as any)?.die_status))
    .sort((a, b) => a.next_nitriding_due_date.localeCompare(b.next_nitriding_due_date)).slice(0, 10)
    .map(r => ({ die_id: r.die_id, die_number: (r.dies as any)?.die_number ?? "Die", tone: r.next_nitriding_due_date <= today ? "warning" as const : "info" as const,
      detail: r.next_nitriding_due_date <= today ? `Nitriding overdue since ${shortDay(r.next_nitriding_due_date)}` : `Nitriding due ${shortDay(r.next_nitriding_due_date)}` }));
  if (nitriding.error) errors.push("Nitriding dates are unavailable.");
  const recoveryItems = (dies.data ?? []).map((d: any) => ({ ...d, min_acceptable: (Array.isArray(d.aluminium_profiles) ? d.aluminium_profiles[0] : d.aluminium_profiles)?.min_acceptable_recovery_percent }))
    .filter(poorRecovery).slice(0, 10)
    .map((d: any) => ({ die_id: d.id, die_number: d.die_number, tone: "warning" as const, detail: `Recovery ${Number(d.average_recovery_percent).toFixed(1)}% over ${d.total_runs} runs (target ${d.min_acceptable ?? POOR_RECOVERY_PERCENT}%)` }));
  if (dies.error) errors.push("Die recovery is unavailable.");
  const awayRows = away.error ? [] : ((away.data as any)?.rows ?? []) as { die_id: string; die_number: string; state: { reason: string; until: string | null; overdue: boolean; custodian?: string | null } }[];
  const awayItems = awayRows.map(r => ({ die_id: r.die_id, die_number: r.die_number, tone: r.state.overdue ? "warning" as const : "info" as const,
    detail: `${r.state.reason === "at_vendor" ? `With ${r.state.custodian ?? "a vendor"}` : `Away: ${r.state.reason.replaceAll("_", " ")}`}${r.state.overdue ? `, overdue since ${shortDay(r.state.until)}` : r.state.until ? `, back ${shortDay(r.state.until)}` : ", return date not recorded"}` }));
  if (away.error && !["PGRST202", "42883"].includes(away.error.code ?? "")) errors.push("Die availability is unavailable.");
  const driftRows = drift.error ? [] : ((drift.data as any)?.rows ?? []) as { target_key: string; title: string; reason: string }[];
  const driftItems = driftRows.slice(0, 10).map(r => ({ die_id: r.target_key.slice(0, 36), die_number: /on die (.+)$/.exec(r.title)?.[1] ?? "Die", tone: "warning" as const, detail: r.reason }));
  return { nitriding: nitridingItems, away: awayItems, recovery: recoveryItems, drift: driftItems, errors };
}
