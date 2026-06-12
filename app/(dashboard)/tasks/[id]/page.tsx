import { RecordDetailClient } from "@/components/modules/operations/record-detail-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await getSessionContext();
  if (!can(context.role, "read", "tasks")) redirect("/tasks");
  const { id } = await params;
  return <RecordDetailClient moduleKey="tasks" recordId={id} context={context} canEdit={can(context.role, "update", "tasks")} />;
}
