import { redirect } from "next/navigation";
import { OnboardingForm } from "@/components/modules/auth-forms";
import { createClient } from "@/lib/supabase/server";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: appUser } = await supabase.from("app_users").select("company_id").eq("id", user.id).maybeSingle();
  if (appUser?.company_id) redirect("/dashboard");
  return <OnboardingForm />;
}
