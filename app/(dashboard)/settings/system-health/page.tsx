import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { SystemHealth } from "@/components/modules/fs-batch4/system-health";
import { getSessionContext } from "@/lib/auth";

// FS-07: scheduled-job health and application errors for the owner and admin.
export default async function SystemHealthPage() {
  const context = await getSessionContext();
  if (context.dealerId || !["owner", "admin"].includes(context.role)) redirect("/dashboard");
  return <div className="space-y-5">
    <PageHeader title="System health" description="Failed scheduled jobs and application errors, so a problem at 2 a.m. is visible the next morning." actions={<Link href="/settings" className="text-sm font-bold underline">Settings</Link>} />
    <SystemHealth />
  </div>;
}
