import { PurchaseLifecycle } from "@/components/modules/vendors/purchase-lifecycle";
import { purchaseLifecycleAction } from "@/lib/actions/purchase-lifecycle";
import { getSessionContext } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function VendorPurchasingPage({ searchParams }: { searchParams?: Promise<{ order_id?: string; bill_id?: string }> }) {
  const context = await getSessionContext();
  if (context.dealerId || !["owner", "admin", "accounts", "inventory_manager"].includes(context.role)) redirect("/vendors");
  const query = await searchParams;
  const [result, selectionResult] = await Promise.all([
    purchaseLifecycleAction({ command: "dashboard.load", payload: {} }),
    query?.bill_id
      ? purchaseLifecycleAction({ command: "bill.load", payload: { bill_id: query.bill_id } })
      : query?.order_id
        ? purchaseLifecycleAction({ command: "order.load", payload: { purchase_order_id: query.order_id } })
        : Promise.resolve(null)
  ]);
  const initialData = result.success && result.data.kind === "dashboard" ? result.data : null;
  const initialSelection = selectionResult?.success
    && (selectionResult.data.kind === "order_loaded" || selectionResult.data.kind === "bill_loaded")
    ? selectionResult.data
    : null;
  const initialError = selectionResult && !selectionResult.success ? selectionResult.error : result.success ? null : result.error;
  return <PurchaseLifecycle key={`${context.companyId}:${context.userId}:${query?.bill_id ?? query?.order_id ?? "overview"}`} initialData={initialData} initialError={initialError} initialSelection={initialSelection} role={context.role} />;
}
