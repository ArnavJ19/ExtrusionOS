import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { CockpitClient } from "@/components/modules/intelligence/cockpit";
import { getSessionContext } from "@/lib/auth";
import { COCKPIT_ROLES } from "@/lib/intelligence/commands";

// FS-38: the owner's one screen and morning brief.
export default async function CockpitPage() {
  const context = await getSessionContext();
  if (context.dealerId || !(COCKPIT_ROLES as readonly string[]).includes(context.role)) redirect("/dashboard");
  return <div className="mx-auto max-w-5xl space-y-5">
    <PageHeader title="Owner cockpit" description="Yesterday, now and what needs you — each number opens the list behind it." />
    <CockpitClient />
  </div>;
}
