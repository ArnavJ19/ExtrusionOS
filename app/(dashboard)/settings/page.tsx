import { SettingsClient } from "@/components/modules/settings-client";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function SettingsPage() {
  const context = await getSessionContext();
  const supabase = await createClient();
  const [companyResult, settingsResult] = await Promise.all([
    supabase.from("companies").select("*").eq("id", context.companyId).single(),
    supabase.from("company_settings").select("*").eq("company_id", context.companyId).maybeSingle()
  ]);
  return <SettingsClient context={context} company={companyResult.data ?? { id: context.companyId, name: context.companyName }} settings={settingsResult.data} />;
}
