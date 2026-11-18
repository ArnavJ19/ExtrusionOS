import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { CoatingRunsClient } from "@/components/modules/autopilot-batch10/coating";
import { getSessionContext } from "@/lib/auth";
import { COATING_ROLES } from "@/lib/autopilot-batch10/commands";

// AP-055: powder coating runs batched by shade and powder brand.
export default async function CoatingRunsPage() {
  const context = await getSessionContext();
  if (context.dealerId || !(COATING_ROLES as readonly string[]).includes(context.role)) redirect("/production/finishing");
  return <div className="space-y-5">
    <PageHeader title="Coating runs by shade" description="Group material waiting for powder coating by shade so the line changes colour less, and see which promised dates the order would miss." actions={<Link href="/production/finishing" className="text-sm font-bold underline">Back to finishing</Link>} />
    <CoatingRunsClient />
  </div>;
}
