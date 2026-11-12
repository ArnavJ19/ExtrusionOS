import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { InventoryLedger } from "@/components/modules/autopilot-operations/operations";
import { getSessionContext } from "@/lib/auth";

export default async function InventoryMovementsPage() {
  const context = await getSessionContext();
  if (context.dealerId || !["owner", "admin", "accounts", "inventory_manager", "production_manager", "factory_manager"].includes(context.role)) redirect("/dashboard");
  return <div className="space-y-5"><PageHeader title="Stock ledger" description="Reconcile balances and approve stock corrections with a retained movement trail." /><InventoryLedger canSetPolicy={["owner", "admin"].includes(context.role)} /></div>;
}
