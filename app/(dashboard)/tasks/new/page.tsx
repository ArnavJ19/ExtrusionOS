import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function NewTaskPage() {
  const context = await getSessionContext();
  if (!can(context.role, "create", "tasks")) redirect("/tasks");
  redirect("/tasks");
}
