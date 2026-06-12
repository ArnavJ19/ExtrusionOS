import { PageHeader } from "@/components/layout/page-header";
import { TasksDashboardClient } from "@/components/modules/tasks-dashboard-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function TasksPage() {
  const context = await getSessionContext();
  if (!can(context.role, "read", "tasks")) redirect("/dashboard");
  const supabase = await createClient();
  const taskQuery = supabase.from("tasks").select("*, dealers(dealer_name)").eq("company_id", context.companyId).order("due_date", { ascending: true }).order("created_at", { ascending: false }).limit(250);
  const userQuery = supabase.from("app_users").select("id, full_name, email, role, dealer_id").eq("company_id", context.companyId).eq("is_active", true).order("full_name").limit(1000);
  const dealerQuery = supabase.from("dealers").select("id, dealer_name, dealer_code").eq("company_id", context.companyId).order("dealer_name").limit(500);
  if (context.dealerId) {
    taskQuery.or(`dealership_id.eq.${context.dealerId},assigned_to.eq.${context.userId},created_by.eq.${context.userId}`);
    userQuery.eq("dealer_id", context.dealerId);
    dealerQuery.eq("id", context.dealerId);
  }
  const [tasksResult, usersResult, dealersResult] = await Promise.all([taskQuery, userQuery, dealerQuery]);
  const usersById = new Map((usersResult.data ?? []).map((user: any) => [user.id, user]));
  const tasks = (tasksResult.data ?? []).map((task: any) => ({ ...task, assignee: usersById.get(task.assigned_to) ?? null, creator: usersById.get(task.created_by) ?? null }));
  return <div className="space-y-6"><PageHeader title="Tasks" description="Dealer and factory task dashboard with daily assignments, employee completion, priority mix, and owner-to-dealer follow-ups." /><TasksDashboardClient context={context} tasks={tasks as any} users={(usersResult.data ?? []) as any} dealers={(dealersResult.data ?? []) as any} /></div>;
}
