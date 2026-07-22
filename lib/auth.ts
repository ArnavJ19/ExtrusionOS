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

  const company = appUser.companies as { name?: string } | null;
  return {
    userId: user.id,
    email: user.email ?? null,
    companyId: appUser.company_id,
    companyName: company?.name ?? "Company",
    fullName: appUser.full_name,
    role: appUser.role as UserRole,
    dealerId: appUser.dealer_id ?? null,
    department: appUser.department ?? null,
    salesRegion: appUser.sales_region ?? null
  };
}
