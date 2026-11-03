import { getSessionContext } from "@/lib/auth";
import { redirect } from "next/navigation";
import { canReadAssurance } from "@/lib/workflow/assurance";
import { AssuranceActionCenter } from "@/components/modules/assurance/action-center";

export default async function AssuranceLayout({ children }: { children: React.ReactNode }) {
  const context = await getSessionContext();
  if (context.dealerId || !canReadAssurance(context.role)) redirect("/tasks");
  return <div className="min-w-0 space-y-5"><AssuranceActionCenter key={`${context.companyId}:${context.userId}:${context.role}`} context={context}>{children}</AssuranceActionCenter></div>;
}
