import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { FactoryDeliveryForecast } from "@/components/modules/production/factory-planning";
import { VehicleLoads } from "@/components/modules/dispatches/vehicle-loads";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { getFactoryVehicleLoadSnapshotAction } from "@/lib/actions/factory-planning";
import { createClient } from "@/lib/supabase/server";

const loadRoles = ["owner", "admin", "factory_manager", "dispatch_manager", "dispatch"];
const forecastRoles = ["owner", "admin", "sales_manager", "sales", "production_manager", "production", "factory_manager", "dispatch_manager", "dispatch"];

export default async function VehicleLoadsPage() {
  const context = await getSessionContext();
  const canManageLoads = !context.dealerId && loadRoles.includes(context.role);
  const canForecast = !context.dealerId && forecastRoles.includes(context.role) && can(context.role, "read", "orders");
  if (!canManageLoads && !canForecast) redirect("/dashboard");

  const supabase = await createClient();
  const [snapshot, ordersResult] = await Promise.all([
    canManageLoads ? getFactoryVehicleLoadSnapshotAction() : Promise.resolve(null),
    canForecast ? supabase.from("orders_authorized").select("id, order_number, customer_name").eq("company_id", context.companyId)
      .not("current_stage", "in", "(cancelled,closed,delivered,dispatched)").order("expected_dispatch_date", { ascending: true, nullsFirst: false }).limit(200) : Promise.resolve(null)
  ]);
  return (
    <div className="space-y-6">
      <PageHeader title="Vehicle Loads and Delivery Forecast" description="Plan measured bundles by vehicle, then review a separate order-specific dispatch forecast from available stock and factory capacity." />
      {canForecast ? <FactoryDeliveryForecast
        orders={(ordersResult?.data ?? []).map(order => ({ id: order.id, order_number: order.order_number, customer_name: order.customer_name }))}
        loadError={ordersResult?.error ? "Open orders could not be loaded for delivery forecasting." : null}
      /> : null}
      {canManageLoads ? <VehicleLoads
        initialSnapshot={snapshot?.success ? snapshot.data : null}
        initialError={snapshot?.success ? null : snapshot?.error ?? "Vehicle loads could not be loaded."}
        canConfigure={["owner", "admin", "factory_manager", "dispatch_manager"].includes(context.role)}
      /> : null}
    </div>
  );
}
