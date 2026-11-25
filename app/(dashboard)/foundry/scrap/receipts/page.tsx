import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { ReceiptRegister } from "@/components/modules/foundry/scrap-receiving/scrap-receipts";
import { getSessionContext } from "@/lib/auth";
import { SCRAP_RECEIPT_READERS, SCRAP_RECEIVERS } from "@/lib/foundry/scrap-receiving";

const STATUSES = ["all", "in_progress", "exit_requested", "completed", "exited", "finance_pending"];

export default async function ScrapReceiptsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const context = await getSessionContext();
  if (context.dealerId || !(SCRAP_RECEIPT_READERS as readonly string[]).includes(context.role)) redirect("/dashboard");
  const params = await searchParams;
  const status = params.status && STATUSES.includes(params.status) ? params.status : context.role === "accounts" ? "finance_pending" : context.role === "factory_manager" ? "in_progress" : "all";
  const canReceive = (SCRAP_RECEIVERS as readonly string[]).includes(context.role);
  return <div className="space-y-5">
    <PageHeader title="Scrap receipts" description="Loads received through the guided procedure: presence, visual verification with weighbridge weight and photos, and material details."
      actions={canReceive ? <Link href="/foundry/scrap/receive" className="inline-flex rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-bold text-white">Start receiving scrap</Link> : <Link href="/foundry/metal-finance" className="text-sm font-bold underline">Metal bills</Link>} />
    <ReceiptRegister initialStatus={status} />
  </div>;
}
