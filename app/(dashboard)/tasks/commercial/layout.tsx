import { getSessionContext } from "@/lib/auth";
import { redirect } from "next/navigation";
import { canReadCommercial } from "@/lib/workflow/commercial";
import { CommercialActionCenter } from "@/components/modules/commercial/action-center";

export default async function CommercialLayout({ children }: { children: React.ReactNode }) {
  const context = await getSessionContext();
  if (context.dealerId || !canReadCommercial(context.role)) redirect("/tasks");
  return <div className="min-w-0 space-y-5"><CommercialActionCenter key={`${context.companyId}:${context.userId}:${context.role}`} context={context}>{children}</CommercialActionCenter></div>;
}
