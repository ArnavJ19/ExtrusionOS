import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function TasksDatabasePage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const context = await getSessionContext();
  await searchParams;
  if (!can(context.role, "read", "tasks")) redirect("/dashboard");
  redirect("/tasks");
}
