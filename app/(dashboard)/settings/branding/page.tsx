import { redirect } from "next/navigation";
import { BrandingSettingsClient } from "@/components/modules/branding-settings-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";

export default async function BrandingPage() {
  const context = await getSessionContext();
  if (!can(context.role, "update", "settings")) redirect("/dashboard");

  const supabase = await createClient();
  const [companyResult, settingsResult] = await Promise.all([
    supabase.from("companies").select("id, name, logo_url").eq("id", context.companyId).single(),
    supabase.from("company_settings").select("*").eq("company_id", context.companyId).maybeSingle()
  ]);

  return <BrandingSettingsClient company={companyResult.data ?? { id: context.companyId, name: context.companyName, logo_url: null }} settings={settingsResult.data} />;
}
