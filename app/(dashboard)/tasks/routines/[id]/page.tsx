import { notFound, redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { canUseCollaboration } from "@/lib/operations/collaboration-workflows";
import { RoutineDetail } from "@/components/modules/operations/collaboration-tools";

export default async function RoutinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params, context = await getSessionContext();
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) notFound();
  if (context.dealerId || !canUseCollaboration(context.role, "routines.load")) redirect("/tasks");
  return <RoutineDetail key={`${context.companyId}:${context.userId}:${context.role}:${id}`} context={context} runId={id} />;
}
