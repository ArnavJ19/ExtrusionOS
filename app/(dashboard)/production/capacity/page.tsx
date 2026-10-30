import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { FactoryPlanning } from "@/components/modules/production/factory-planning";
import { ModuleDisabled } from "@/components/ui/module-disabled";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { getFeatureFlagsForCompany, isFeatureEnabled } from "@/lib/enterprise/features";
import { getFactoryPlanningSnapshotAction } from "@/lib/actions/factory-planning";
import { createClient } from "@/lib/supabase/server";

export default async function FactoryCapacityPage() {
  const context = await getSessionContext();
  const supabase = await createClient();
  const flags = await getFeatureFlagsForCompany(supabase, context.companyId);
  if (!isFeatureEnabled(flags, "production_planning")) return <ModuleDisabled moduleName="production_planning" title="Factory Capacity" />;
  if (context.dealerId || !can(context.role, "read", "production")) redirect("/dashboard");

  const [snapshot, ordersResult] = await Promise.all([
    getFactoryPlanningSnapshotAction(),
    supabase.from("orders_authorized").select("id, order_number, customer_name").eq("company_id", context.companyId)
      .not("current_stage", "in", "(cancelled,closed,delivered,dispatched)").order("expected_dispatch_date", { ascending: true, nullsFirst: false }).limit(200)
  ]);
  return (
    <div className="space-y-6">
      <PageHeader title="Factory Capacity" description="Plan real extrusion slots against weekly press capacity, maintenance windows, and finishing lead times." />
      <FactoryPlanning
        initialSnapshot={snapshot.success ? snapshot.data : null}
        initialError={snapshot.success ? null : snapshot.error}
        canMove={can(context.role, "update", "production")}
        canConfigure={["owner", "admin", "production_manager", "factory_manager"].includes(context.role)}
        orders={(ordersResult.data ?? []).map(order => ({ id: order.id, order_number: order.order_number, customer_name: order.customer_name }))}
      />
    </div>
  );
}
