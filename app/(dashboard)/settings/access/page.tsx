import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { AccessControlClient } from "@/components/modules/access-control-client";
import { QueryErrorNotice } from "@/components/ui/query-error-notice";
import { can } from "@/lib/auth/permissions";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils/errors";

export default async function AccessPage() {
  const context = await getSessionContext();
  if (!can(context.role, "read", "users")) redirect("/dashboard");
  const supabase = await createClient();
  await supabase.rpc("seed_default_roles_for_company" as any, { target_company_id: context.companyId });

  let usersQuery = supabase.from("app_users").select("id, full_name, email, phone, role, is_active, status, department, sales_region, dealers(dealer_name)").eq("company_id", context.companyId).order("updated_at", { ascending: false }).limit(100);
  let invitesQuery = supabase.from("invitations").select("id, full_name, email, status, expires_at, dealers(dealer_name)").eq("company_id", context.companyId).order("created_at", { ascending: false }).limit(50);
  let dealersQuery = supabase.from("dealers").select("id, dealer_name, dealer_code, is_active").eq("company_id", context.companyId).order("dealer_name");

  if (context.dealerId) {
    usersQuery = usersQuery.eq("dealer_id", context.dealerId);
    invitesQuery = invitesQuery.eq("dealer_id", context.dealerId);
    dealersQuery = dealersQuery.eq("id", context.dealerId);
  }

  const [users, roles, invites, dealers] = await Promise.all([
    usersQuery,
    supabase.from("roles").select("id, role_key, name, description, is_system, is_active").eq("company_id", context.companyId).order("is_system", { ascending: false }),
    invitesQuery,
    dealersQuery
  ]);
  const errors = [users, roles, invites, dealers].map((result) => result.error ? getErrorMessage(result.error) : "").filter(Boolean);

  return (
    <div>
      <PageHeader title="Users & Roles" description="Invite employees and dealer users, assign roles, and review the permission matrix for backend-enforced access control." />
      <QueryErrorNotice messages={errors} />
      <AccessControlClient users={users.data ?? []} roles={roles.data ?? []} invites={invites.data ?? []} dealers={dealers.data ?? []} />
    </div>
  );
}
