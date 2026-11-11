import { HubReportNotice } from "@/components/modules/home-work/hub-report-notice";
import { getSessionContext } from "@/lib/auth";
import { redirect } from "next/navigation";
import { canReadExecution } from "@/lib/workflow/execution";
import { ExecutionActionCenter } from "@/components/modules/execution/action-center";

export default async function ExecutionLayout({ children }: { children: React.ReactNode }) {
  const context = await getSessionContext();
  if (context.dealerId || !canReadExecution(context.role)) redirect("/tasks");
  return <div className="min-w-0 space-y-5"><HubReportNotice /><ExecutionActionCenter key={`${context.companyId}:${context.userId}:${context.role}`} context={context}>{children}</ExecutionActionCenter></div>;
}
