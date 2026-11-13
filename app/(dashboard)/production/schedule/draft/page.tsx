import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { getSessionContext } from "@/lib/auth";
import { PressPlanDraft } from "@/components/modules/autopilot-batch6/press-plan";
import { PLAN_EDITORS, PLAN_READERS } from "@/lib/autopilot-batch6/commands";

export default async function PressPlanDraftPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const context = await getSessionContext();
  if (context.dealerId || !(PLAN_READERS as readonly string[]).includes(context.role)) redirect("/dashboard");
  const date = (await searchParams).date;
  return <div className="space-y-5"><PageHeader title="Draft press plan" description="Tomorrow's plan, prepared overnight. Review, adjust and publish." actions={<Link href="/production/schedule" className="text-sm font-bold underline">Published schedule</Link>} />
    <PressPlanDraft initialDate={date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined} canEdit={(PLAN_EDITORS as readonly string[]).includes(context.role)} /></div>;
}
