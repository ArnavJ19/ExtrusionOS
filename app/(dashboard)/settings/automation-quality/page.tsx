import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { getSessionContext } from "@/lib/auth";
import { QualityClient } from "@/components/modules/autopilot-batch7/quality";
import { QUALITY_READERS, QUALITY_RECORDERS } from "@/lib/autopilot-batch7/commands";

// AP-003: Settings → Automation quality.
export default async function AutomationQualityPage() {
  const context = await getSessionContext();
  if (context.dealerId || !(QUALITY_READERS as readonly string[]).includes(context.role)) redirect("/dashboard");
  return <div className="space-y-5">
    <PageHeader title="Automation quality" description="How often each kind of system proposal is accepted as prepared, changed, rejected or left to expire, so a rule that people keep correcting gets reviewed."
      actions={<Link href="/settings" className="text-sm font-bold underline">Back to settings</Link>} />
    <QualityClient canRecord={(QUALITY_RECORDERS as readonly string[]).includes(context.role)} />
  </div>;
}
