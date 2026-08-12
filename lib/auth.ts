import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { SessionContext, UserRole } from "@/types/app";

export async function getSessionContext(): Promise<SessionContext> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: appUser } = await supabase.from("app_users").select("*, companies(name)").eq("id", user.id).single();
  if (appUser && !appUser.is_active) redirect("/access-suspended");
  if (!appUser?.company_id) redirect("/onboarding");

  const role = appUser.role as UserRole;
  // Effective granular permissions from custom roles (user_roles -> role_permissions).
  // Owner/admin already have full access via can(), so skip the lookup for them. Any
  // failure (e.g. RLS) degrades to no extra grants, which can only ever remove access,
  // never break the session.
  let permissions: string[] = [];
  if (role !== "owner" && role !== "admin") {
    try {
      const { data: grantRows } = await supabase
        .from("user_roles")
        .select("roles(role_permissions(permission_key))")
        .eq("user_id", user.id)
        .eq("company_id", appUser.company_id);
      permissions = [...new Set(
        (grantRows ?? []).flatMap((row: any) => {
          const roles = Array.isArray(row.roles) ? row.roles : row.roles ? [row.roles] : [];
          return roles.flatMap((r: any) => (r?.role_permissions ?? []).map((p: any) => p.permission_key));
        }).filter(Boolean)
      )] as string[];
    } catch {
      permissions = [];
    }
  }

  const company = appUser.companies as { name?: string } | null;
  return {
    userId: user.id,
    email: user.email ?? null,
    companyId: appUser.company_id,
    companyName: company?.name ?? "Company",
    fullName: appUser.full_name,
    role,
    dealerId: appUser.dealer_id ?? null,
    department: appUser.department ?? null,
    salesRegion: appUser.sales_region ?? null,
    permissions
  };
}
