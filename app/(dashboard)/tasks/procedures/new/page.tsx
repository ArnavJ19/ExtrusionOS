import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { canUseCollaboration } from "@/lib/operations/collaboration-workflows";
import { ProcedureCreate } from "@/components/modules/operations/collaboration-tools";

export default async function NewProcedurePage() {
  const context = await getSessionContext();
  if (context.dealerId || !canUseCollaboration(context.role, "procedures.create")) redirect("/tasks/procedures");
  return <ProcedureCreate key={`${context.companyId}:${context.userId}:${context.role}`} context={context} />;
}
