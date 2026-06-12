import { PageHeader } from "@/components/layout/page-header";
import { QueryErrorNotice } from "@/components/ui/query-error-notice";
import { DieIntelligenceClient } from "@/components/modules/die-intelligence-client";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils/errors";

export default async function DieIntelligencePage() {
  const context = await getSessionContext();
  const supabase = await createClient();

  const [diesResult, metricsResult, trialsResult, correctionsResult, nitridingDueResult] = await Promise.all([
    supabase
      .from("dies")
      .select("id, die_number, die_code, die_status, die_type, ownership_type, performance_grade, total_production_kg, total_runs, last_used_date, die_manufacturer, die_cost, correction_history, average_recovery_percent, die_diameter_mm, number_of_cavities, priority_level, profile_id, customer_id, aluminium_profiles!dies_profile_id_fkey(profile_code, profile_name), customers(customer_name, company_name)")
      .eq("company_id", context.companyId)
      .order("die_number", { ascending: true }),
    supabase
      .from("die_health_metrics")
      .select("*")
      .eq("company_id", context.companyId),
    supabase
      .from("die_trials")
      .select("*")
      .eq("company_id", context.companyId)
      .order("trial_date", { ascending: false })
      .limit(200),
    supabase
      .from("die_corrections")
      .select("*")
      .eq("company_id", context.companyId)
      .order("correction_date", { ascending: false })
      .limit(200),
    supabase
      .from("die_nitriding_history")
      .select("die_id, next_nitriding_due_date")
      .eq("company_id", context.companyId)
      .not("next_nitriding_due_date", "is", null)
      .order("nitriding_date", { ascending: false })
      .limit(200),
  ]);

  const metricsByDieId = new Map((metricsResult.data ?? []).map((metric: any) => [metric.die_id, metric]));
  const trialCounts = new Map<string, number>();
  const correctionCounts = new Map<string, number>();
  const nitridingDueByDie = new Map<string, string>();

  for (const trial of trialsResult.data ?? []) trialCounts.set(trial.die_id, (trialCounts.get(trial.die_id) ?? 0) + 1);
  for (const correction of correctionsResult.data ?? []) correctionCounts.set(correction.die_id, (correctionCounts.get(correction.die_id) ?? 0) + 1);
  for (const n of nitridingDueResult.data ?? []) {
    if (!nitridingDueByDie.has(n.die_id)) nitridingDueByDie.set(n.die_id, n.next_nitriding_due_date);
  }

  const today = new Date().toISOString().slice(0, 10);

  const dies = (diesResult.data ?? []).map((die: any) => {
    const metric = metricsByDieId.get(die.id) as any | undefined;
    const profile = die.aluminium_profiles as any;
    const customer = die.customers as any;
    const nitridingDue = nitridingDueByDie.get(die.id);
    const nitridingOverdue = nitridingDue ? nitridingDue <= today : false;
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
      nitriding_overdue: nitridingOverdue,
      performance_grade: die.performance_grade ?? "good",
    };
  });

  const queryErrors = [diesResult, metricsResult, trialsResult, correctionsResult, nitridingDueResult]
    .map((result) => result.error ? getErrorMessage(result.error) : "")
    .filter(Boolean);

  return (
    <div className="space-y-6">
      <PageHeader title="Die Intelligence" description="Health scores, trial history, corrections, and lifecycle optimization from your die database only." />
      <QueryErrorNotice messages={queryErrors} />
      <DieIntelligenceClient dies={dies} trials={trialsResult.data ?? []} corrections={correctionsResult.data ?? []} />
    </div>
  );
}

function healthFromStatus(status: string | null) {
  if (status === "dead") return 0;
  if (status === "inactive") return 25;
  if (status === "correction") return 45;
  if (status === "trial" || status === "nitriding") return 70;
  return 85;
}

function recommendationFromStatus(status: string | null) {
  if (status === "dead") return "dead";
  if (status === "inactive") return "replace_soon";
  if (status === "correction") return "correction_needed";
  if (status === "trial" || status === "nitriding") return "monitor";
  return "healthy";
}
