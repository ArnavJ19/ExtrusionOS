import { redirect } from "next/navigation";
import { FinancialWorkflowReviewClient } from "@/components/modules/financials/financial-workflow-review";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";

export default async function InvoiceEligibilityPage() {
  const context = await getSessionContext();
  if (!can(context.role, "read", "financials")) redirect("/dashboard");
  return <FinancialWorkflowReviewClient mode="eligibility" />;
}
