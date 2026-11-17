import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { getSessionContext } from "@/lib/auth";
import { NcrClient } from "@/components/modules/autopilot-batch6/ncr";
import { NCR_DECIDERS, NCR_READERS } from "@/lib/autopilot-batch6/commands";

export default async function NcrPage() {
  const context = await getSessionContext();
  if (context.dealerId || !(NCR_READERS as readonly string[]).includes(context.role)) redirect("/dashboard");
  return <div className="space-y-5"><PageHeader title="NCRs" description="Non-conformance reports drafted from rejections and complaints." actions={<Link href="/quality" className="text-sm font-bold underline">Back to quality</Link>} />
    <NcrClient canDecide={(NCR_DECIDERS as readonly string[]).includes(context.role)} canSetThresholds={["owner", "admin", "quality"].includes(context.role)} /></div>;
}
