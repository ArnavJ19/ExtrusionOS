import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { canUseCollaboration } from "@/lib/operations/collaboration-workflows";
import { RoutineDirectory } from "@/components/modules/operations/collaboration-tools";

export default async function RoutinesPage() {
  const context = await getSessionContext();
  if (context.dealerId || !canUseCollaboration(context.role, "routines.list")) redirect("/tasks");
  return <RoutineDirectory key={`${context.companyId}:${context.userId}:${context.role}`} />;
}
