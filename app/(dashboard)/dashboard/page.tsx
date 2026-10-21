import { PageHeader } from "@/components/layout/page-header";
import { QueryErrorNotice } from "@/components/ui/query-error-notice";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { parseDashboardSnapshot } from "@/lib/analytics/dashboard-snapshot";
import { DashboardTabs } from "@/components/modules/dashboard-client";
import { getDashboardExperience } from "@/lib/auth/role-experience";
import { getBusinessDateBoundaries } from "@/lib/utils/business-date";
import { redirect } from "next/navigation";
import { MyWorkToday } from "@/components/modules/my-work-today";
import { loadMyWork } from "@/lib/dashboard/my-work";
import { getFeatureFlagsForCompany } from "@/lib/enterprise/features";

export default async function DashboardPage() {
  const context = await getSessionContext();
  if (context.role === "dealer_admin" || context.role === "dealer_staff") {
    redirect("/portal/dashboard");
  }
  const experience = getDashboardExperience(context.role);
  const supabase = await createClient();
  const now = new Date();
  const { today } = getBusinessDateBoundaries(now);
  const flags = await getFeatureFlagsForCompany(supabase, context.companyId);
  const [work, result] = await Promise.all([
    loadMyWork(supabase, context, flags, now),
    supabase.rpc("get_dashboard_snapshot" as any, { p_as_of: today })
  ]);
  const snapshot = result.error ? null : parseDashboardSnapshot(result.data, today, now);

  return (
    <div className="space-y-8">
      <MyWorkToday work={work} name={context.fullName || ""} role={context.role} />
      <details className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-6">
        <summary className="cursor-pointer text-base font-bold text-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">Business snapshot</summary>
        <div className="mt-6">
          {snapshot ? <>
            <PageHeader title="Business snapshot" description={experience.initialView === "operations" ? "Operational snapshot of production, quality, inventory, and dispatch work requiring attention." : "Commercial snapshot of quotation activity, order movement, and customer follow-up."} />
            {snapshot.unknownShipmentCount > 0 ? <QueryErrorNotice messages={[`${snapshot.unknownShipmentCount} activated dispatches have incomplete movement evidence and are excluded from MTD shipment counts. Reconcile these records before assessing shipment performance.`]} /> : null}
            <DashboardTabs
              allowedViews={experience.allowedViews}
              initialView={experience.initialView}
              operationalResources={experience.operationalResources}
              operationsHref={experience.operationsHref}
              {...snapshot}
            />
          </> : <QueryErrorNotice messages={["Dashboard data is unavailable. Please retry; no totals or health conclusions can be established."]} />}
        </div>
      </details>
    </div>
  );
}
