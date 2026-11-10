import { redirect } from "next/navigation";
import { FinancialWorkflowReviewClient } from "@/components/modules/financials/financial-workflow-review";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { getBusinessDateBoundaries } from "@/lib/utils/business-date";
import { ReceiptAllocationPanel } from "@/components/modules/order-to-cash/cash";

export default async function ReceiptsPage() {
  const context = await getSessionContext();
  if (!can(context.role, "read", "financials")) redirect("/dashboard");
  return <div className="space-y-5">
    {["owner", "admin", "accounts"].includes(context.role) && !context.dealerId ? <ReceiptAllocationPanel today={getBusinessDateBoundaries().today} /> : null}
    <FinancialWorkflowReviewClient mode="receipts" />
  </div>;
}
