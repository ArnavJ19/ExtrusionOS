import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { ReceiptView } from "@/components/modules/foundry/scrap-receiving/scrap-receipts";
import { getSessionContext } from "@/lib/auth";
import { SCRAP_RECEIPT_READERS } from "@/lib/foundry/scrap-receiving";

export default async function ScrapReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSessionContext();
  if (context.dealerId || !(SCRAP_RECEIPT_READERS as readonly string[]).includes(context.role)) redirect("/dashboard");
  if (!/^[0-9a-f-]{36}$/i.test(id)) redirect("/foundry/scrap/receipts");
  return <div className="mx-auto max-w-5xl space-y-5">
    <PageHeader title="Scrap receipt" backHref="/foundry/scrap/receipts" backLabel="Scrap receipts" actions={context.role === "accounts" ? <Link href="/foundry/metal-finance" className="text-sm font-bold underline">Metal bills</Link> : undefined} />
    <ReceiptView companyId={context.companyId} id={id} />
  </div>;
}
