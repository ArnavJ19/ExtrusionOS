import { HubReportNotice } from "@/components/modules/home-work/hub-report-notice";
import { getSessionContext } from "@/lib/auth";
import { redirect } from "next/navigation";
import { canReadLifecycle } from "@/lib/workflow/lifecycle";
import { LifecycleActionCenter } from "@/components/modules/lifecycle/action-center";

export default async function LifecycleLayout({ children }: { children: React.ReactNode }) {
  const context = await getSessionContext();
  if (context.dealerId || !canReadLifecycle(context.role)) redirect("/tasks");
  return <div className="min-w-0 space-y-5"><HubReportNotice /><LifecycleActionCenter key={`${context.companyId}:${context.userId}:${context.role}`} context={context}>{children}</LifecycleActionCenter></div>;
}
