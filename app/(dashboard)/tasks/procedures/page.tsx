import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { canUseCollaboration } from "@/lib/operations/collaboration-workflows";
import { ProcedureDirectory } from "@/components/modules/operations/collaboration-tools";

export default async function ProceduresPage() {
  const context = await getSessionContext();
  if (context.dealerId || !canUseCollaboration(context.role, "procedures.list")) redirect("/tasks");
  return <ProcedureDirectory key={`${context.companyId}:${context.userId}:${context.role}`} context={context} />;
}
