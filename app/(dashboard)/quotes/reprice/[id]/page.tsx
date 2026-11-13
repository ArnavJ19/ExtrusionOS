import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { getSessionContext } from "@/lib/auth";
import { RepriceRun } from "@/components/modules/autopilot-batch6/reprice";
import { REPRICE_READERS } from "@/lib/autopilot-batch6/commands";

export default async function RepriceRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  const context = await getSessionContext();
  if (context.dealerId || !(REPRICE_READERS as readonly string[]).includes(context.role)) redirect("/dashboard");
  return <div className="space-y-5"><PageHeader title="Repricing impact list" description="Old and new billet rate and totals for each repriced line." actions={<Link href="/quotes/reprice" className="text-sm font-bold underline print:hidden">Back to repricing</Link>} /><RepriceRun id={id} /></div>;
}
