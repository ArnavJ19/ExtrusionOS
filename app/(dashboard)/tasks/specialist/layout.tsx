import { HubReportNotice } from "@/components/modules/home-work/hub-report-notice";
import { getSessionContext } from "@/lib/auth";
import { redirect } from "next/navigation";
import { canReadSpecialist } from "@/lib/workflow/specialist";
import { SpecialistActionCenter } from "@/components/modules/specialist/action-center";

export default async function SpecialistLayout({ children }: { children: React.ReactNode }) {
  const context = await getSessionContext();
  if (context.dealerId || !canReadSpecialist(context.role)) redirect("/tasks");
  return <div className="min-w-0 space-y-5"><HubReportNotice /><SpecialistActionCenter key={`${context.companyId}:${context.userId}:${context.role}`} context={context}>{children}</SpecialistActionCenter></div>;
}
