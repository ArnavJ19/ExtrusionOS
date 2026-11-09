import { HubReportNotice } from "@/components/modules/home-work/hub-report-notice";
import { getSessionContext } from "@/lib/auth";
import { redirect } from "next/navigation";
import { canReadCoordination } from "@/lib/workflow/coordination";
import { CoordinationActionCenter } from "@/components/modules/coordination/action-center";

export default async function CoordinationLayout({ children }: { children: React.ReactNode }) {
  const context = await getSessionContext();
  if (context.dealerId || !canReadCoordination(context.role)) redirect("/tasks");
  return <div className="min-w-0 space-y-5"><HubReportNotice /><CoordinationActionCenter key={`${context.companyId}:${context.userId}:${context.role}`} context={context}>{children}</CoordinationActionCenter></div>;
}
