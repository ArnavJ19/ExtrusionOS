import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { CustomerCommitmentQueue } from "@/components/modules/operations/operator-tools";
import { getSessionContext } from "@/lib/auth";
import { canUseOperatorCommand } from "@/lib/operations/operator-workflows";

export default async function CustomerCommitmentQueuePage() {
  const context = await getSessionContext();
  if (context.dealerId || !canUseOperatorCommand(context.role, "commitments.queue")) redirect("/dashboard");
  return <div className="space-y-6"><Link className="text-sm font-semibold text-slate-600" href="/tasks">Back to tasks</Link><PageHeader title="Customer commitments" description="Follow up on promised actions, dates and overdue work." /><CustomerCommitmentQueue key={`${context.companyId}:${context.userId}:${context.role}`} context={context} /></div>;
}
