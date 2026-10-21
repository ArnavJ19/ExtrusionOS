import { notFound, redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { canUseCollaboration } from "@/lib/operations/collaboration-workflows";
import { ProcedureDetail } from "@/components/modules/operations/collaboration-tools";

export default async function ProcedurePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params, context = await getSessionContext();
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) notFound();
  if (context.dealerId || !canUseCollaboration(context.role, "procedures.load")) redirect("/tasks");
  return <ProcedureDetail key={`${context.companyId}:${context.userId}:${context.role}:${id}`} context={context} procedureId={id} />;
}
