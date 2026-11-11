import { HubReportNotice } from "@/components/modules/home-work/hub-report-notice";
import { getSessionContext } from "@/lib/auth";
import { redirect } from "next/navigation";
import { canReadImprovement } from "@/lib/workflow/improvement";
import { ImprovementActionCenter } from "@/components/modules/improvement/action-center";

export default async function ImprovementLayout({ children }: { children: React.ReactNode }) {
  const context = await getSessionContext();
  if (context.dealerId || !canReadImprovement(context.role)) redirect("/tasks");
  return <div className="min-w-0 space-y-5"><HubReportNotice /><ImprovementActionCenter key={`${context.companyId}:${context.userId}:${context.role}`} context={context}>{children}</ImprovementActionCenter></div>;
}
