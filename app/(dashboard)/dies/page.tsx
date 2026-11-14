import { DiesOverviewClient } from "@/components/modules/dies/dies-overview-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";
import Link from "next/link";
import { DieFlagsPanel } from "@/components/modules/press/die-service";
import { DieAttentionPanel } from "@/components/modules/autopilot-batch8/die-attention";
import { DieIntelligenceClient } from "@/components/modules/die-intelligence-client";
import { QueryErrorNotice } from "@/components/ui/query-error-notice";
import { DIE_HEALTH_ROLES, loadDieAttention, loadDieHealth } from "@/lib/dies/intelligence";
import { createClient } from "@/lib/supabase/server";

export default async function DiesPage() {
  const context = await getSessionContext();
  if (!can(context.role, "read", "dies")) redirect("/dashboard");
  // AP-028: dies at or near their approved service interval are flagged before the rest of the overview.
  const showFlags = !context.dealerId && ["owner", "admin", "factory_manager", "production_manager", "production", "quality", "sales_manager"].includes(context.role);
  // AP-043: Die Intelligence lives here now: the attention list first, die health (with die cost) for its former audience.
  const showHealth = !context.dealerId && (DIE_HEALTH_ROLES as readonly string[]).includes(context.role);
  const supabase = await createClient();
  const [attention, health] = await Promise.all([
    showFlags ? loadDieAttention(supabase, context.companyId) : Promise.resolve(null),
    showHealth ? loadDieHealth(supabase, context.companyId) : Promise.resolve(null)
  ]);
  return <div className="space-y-6">
    {showFlags ? <Link href="/dies/weight-drift" className="inline-flex min-h-10 items-center rounded-xl bg-neutral-950 px-3 text-sm font-semibold text-white">Section weight by die</Link> : null}
    {attention ? <DieAttentionPanel data={attention} /> : null}
    {showFlags ? <DieFlagsPanel /> : null}
    <DiesOverviewClient context={context} canCreate={can(context.role, "create", "dies")} />
    {health ? <section id="die-health" aria-labelledby="die-health-heading" className="space-y-3">
      <div><h2 id="die-health-heading" className="text-lg font-bold">Die health</h2><p className="text-sm text-neutral-600">Health scores, rejection, corrections, trials and die cost per kg from your die records (formerly Die Intelligence).</p></div>
      <QueryErrorNotice messages={health.errors} />
      <DieIntelligenceClient dies={health.dies} trials={health.trials} corrections={health.corrections} />
    </section> : null}
  </div>;
}
