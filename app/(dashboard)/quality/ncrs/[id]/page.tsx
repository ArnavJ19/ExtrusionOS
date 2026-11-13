import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { getSessionContext } from "@/lib/auth";
import { NcrRecord } from "@/components/modules/autopilot-batch6/ncr";
import { NCR_DECIDERS, NCR_READERS } from "@/lib/autopilot-batch6/commands";

export default async function NcrRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  const context = await getSessionContext();
  if (context.dealerId || !(NCR_READERS as readonly string[]).includes(context.role)) redirect("/dashboard");
  return <div className="space-y-5"><PageHeader title="NCR" description="Linked job, die, billet lots and readings; cause and corrective action." actions={<Link href="/quality/ncrs" className="text-sm font-bold underline">All NCRs</Link>} />
    <NcrRecord id={id} canDecide={(NCR_DECIDERS as readonly string[]).includes(context.role)} /></div>;
}
