import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { TaskCreateForm } from "@/components/modules/task-create-form";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function NewTaskPage() {
  const context = await getSessionContext();
  if (!can(context.role, "create", "tasks")) redirect("/tasks");
  const supabase = await createClient();
  const userQuery = supabase.from("app_users").select("id, full_name, email, role, dealer_id").eq("company_id", context.companyId).eq("is_active", true).order("full_name").limit(1000);
  const dealerQuery = supabase.from("dealers").select("id, dealer_name, dealer_code").eq("company_id", context.companyId).order("dealer_name").limit(500);
  if (context.dealerId) {
    userQuery.eq("dealer_id", context.dealerId);
    dealerQuery.eq("id", context.dealerId);
  }
  const [usersResult, dealersResult] = await Promise.all([userQuery, dealerQuery]);
  return (
    <div className="space-y-6">
      <PageHeader title="Create Task" description="Assign a dealer or factory follow-up with a due date and priority." />
      <Card>
        <CardContent>
          <TaskCreateForm context={context} users={(usersResult.data ?? []) as any} dealers={(dealersResult.data ?? []) as any} redirectTo="/tasks" />
        </CardContent>
      </Card>
    </div>
  );
}
