import { EnterpriseFoundationClient } from "@/components/modules/enterprise-foundation-client";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function EnterpriseFoundationPage() {
  const context = await getSessionContext();
  if (!["owner", "admin"].includes(context.role)) redirect("/dashboard");

  const supabase = await createClient();

  const [flags, branches, plans, subscriptions, notifications, tasks, auditLogs, exchangeJobs, users] = await Promise.all([
    supabase.from("feature_flags").select("*").eq("company_id", context.companyId).order("module_name"),
    supabase.from("branches").select("*").eq("company_id", context.companyId).order("branch_type").order("branch_name"),
    supabase.from("subscription_plans").select("*").eq("is_active", true).order("monthly_price"),
    supabase.from("company_subscriptions").select("*, subscription_plans(plan_name, plan_type)").eq("company_id", context.companyId).order("created_at", { ascending: false }).limit(3),
    supabase.from("notifications").select("*").eq("company_id", context.companyId).order("created_at", { ascending: false }).limit(8),
    supabase.from("tasks").select("*").eq("company_id", context.companyId).order("created_at", { ascending: false }).limit(8),
    supabase.from("audit_logs").select("*").eq("company_id", context.companyId).order("created_at", { ascending: false }).limit(10),
    supabase.from("data_exchange_jobs").select("*").eq("company_id", context.companyId).order("created_at", { ascending: false }).limit(8),
    supabase.from("app_users").select("id, full_name, email, role, is_active, branch_id").eq("company_id", context.companyId).order("full_name")
  ]);

  const errors = [flags, branches, plans, subscriptions, notifications, tasks, auditLogs, exchangeJobs, users]
    .map((result) => result.error?.message ?? "")
    .filter(Boolean);

  return (
    <EnterpriseFoundationClient
      context={context}
      initialFlags={flags.data ?? []}
      initialBranches={branches.data ?? []}
      plans={plans.data ?? []}
      subscriptions={subscriptions.data ?? []}
      initialNotifications={notifications.data ?? []}
      initialTasks={tasks.data ?? []}
      auditLogs={auditLogs.data ?? []}
      exchangeJobs={exchangeJobs.data ?? []}
      users={users.data ?? []}
      queryErrors={errors}
    />
  );
}
