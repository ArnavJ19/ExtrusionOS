import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { BilletForecast } from "@/components/modules/autopilot-operations/operations";
import { getSessionContext } from "@/lib/auth";
import { PLANNERS } from "@/lib/autopilot-batch5/operations";

export default async function BilletForecastPage() {
  const context = await getSessionContext();
  if (context.dealerId || !PLANNERS.includes(context.role)) redirect("/dashboard");
  return <div className="space-y-5"><PageHeader title="Billet forecast" description="Seven days of planned input, available stock, dated supply and shortage proposals." actions={<Link href="/production" className="text-sm font-bold underline">Back to production</Link>} /><BilletForecast /></div>;
}
