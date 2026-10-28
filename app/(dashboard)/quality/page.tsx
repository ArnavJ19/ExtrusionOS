import Link from "next/link";
import { ModuleOverviewClient } from "@/components/modules/operations/module-overview-client";
import { ModuleDisabled } from "@/components/ui/module-disabled";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { getFeatureFlagsForCompany, isFeatureEnabled } from "@/lib/enterprise/features";
import { createClient } from "@/lib/supabase/server";
import { canReadPlans } from "@/lib/workflow/inspection-plans";
import { redirect } from "next/navigation";

export default async function QualityPage() {
  const context = await getSessionContext();
  const supabase = await createClient();
  const flags = await getFeatureFlagsForCompany(supabase, context.companyId);
  if (!isFeatureEnabled(flags, "quality_compliance")) return <ModuleDisabled moduleName="quality_compliance" title="Quality" />;
  if (!can(context.role, "read", "quality")) redirect("/dashboard");
  return (
    <div className="space-y-2">
      <ModuleOverviewClient moduleKey="quality" context={context} canCreate={can(context.role, "create", "quality")} canUpdate={can(context.role, "update", "quality")} />
      {!context.dealerId && canReadPlans(context.role) ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div><p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Inspection Standards</p><h2 className="section-title mt-1">Inspection Plans</h2><p className="mt-1 text-sm font-medium text-slate-500">Approved tests, limits and sampling per profile. Inspections with a plan are approved only when every result is recorded and within limits.</p></div>
            <Link href="/quality/plans" className="inline-flex items-center justify-center rounded-xl bg-charcoal px-4 py-2.5 text-sm font-bold text-white transition hover:bg-charcoal/90">Open Plans</Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
