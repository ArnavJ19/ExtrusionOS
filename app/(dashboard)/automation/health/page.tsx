import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { getSessionContext } from "@/lib/auth";
import { SystemHealth } from "@/components/modules/autopilot-batch6/health";

export default async function SystemHealthPage() {
  const context = await getSessionContext();
  if (context.dealerId || !["owner", "admin"].includes(context.role)) redirect("/dashboard");
  return <div className="space-y-5"><PageHeader title="System health" description="Whether background jobs, exports and integrations are working." actions={<Link href="/automation" className="text-sm font-bold underline">Scheduled jobs</Link>} /><SystemHealth /></div>;
}
