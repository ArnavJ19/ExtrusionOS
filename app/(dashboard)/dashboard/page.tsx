import { PageHeader } from "@/components/layout/page-header";
import { QueryErrorNotice } from "@/components/ui/query-error-notice";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { parseDashboardSnapshot } from "@/lib/analytics/dashboard-snapshot";
import { DashboardTabs } from "@/components/modules/dashboard-client";
import { getDashboardExperience } from "@/lib/auth/role-experience";
import { getBusinessDateBoundaries } from "@/lib/utils/business-date";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const context = await getSessionContext();
  if (context.role === "dealer_admin" || context.role === "dealer_staff") {
    redirect("/portal/dashboard");
  }
  const experience = getDashboardExperience(context.role);
  const supabase = await createClient();
  const now = new Date();
  const { today } = getBusinessDateBoundaries(now);
  const result = await supabase.rpc("get_dashboard_snapshot" as any, { p_as_of: today });
  const snapshot = result.error ? null : parseDashboardSnapshot(result.data, today, now);
  if (!snapshot) return (
    <div>
      <PageHeader title="Dashboard" description="Current business snapshot" />
      <QueryErrorNotice messages={["Dashboard data is unavailable. Please retry; no totals or health conclusions can be established."]} />
    </div>
  );

  return (
    <div>
      <PageHeader title="Dashboard" description={experience.initialView === "operations" ? "Operational snapshot of production, quality, inventory, and dispatch work requiring attention." : "Commercial snapshot of quotation activity, order movement, and customer follow-up."} />
      {snapshot.unknownShipmentCount > 0 ? <QueryErrorNotice messages={[`${snapshot.unknownShipmentCount} activated dispatches have incomplete movement evidence and are excluded from MTD shipment counts. Reconcile these records before assessing shipment performance.`]} /> : null}
      
      <DashboardTabs 
        allowedViews={experience.allowedViews}
        initialView={experience.initialView}
        operationalResources={experience.operationalResources}
        operationsHref={experience.operationsHref}
        {...snapshot}
      />
    </div>
  );
}
