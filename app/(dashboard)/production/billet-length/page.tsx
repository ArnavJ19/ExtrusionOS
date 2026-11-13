import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { getSessionContext } from "@/lib/auth";
import { PressBilletSettings } from "@/components/modules/autopilot-batch6/billet-length";
import { BILLET_PLANNERS } from "@/lib/autopilot-batch6/commands";

export default async function BilletLengthPage() {
  const context = await getSessionContext();
  if (context.dealerId || !(BILLET_PLANNERS as readonly string[]).includes(context.role)) redirect("/dashboard");
  return <div className="space-y-5"><PageHeader title="Billet length" description="Press billet limits for recovery recommendations, and the recovery they achieved." actions={<Link href="/production" className="text-sm font-bold underline">Back to production</Link>} /><PressBilletSettings /></div>;
}
