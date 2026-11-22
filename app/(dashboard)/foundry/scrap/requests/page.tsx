import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { RequestsWorkspace } from "@/components/modules/foundry/scrap-receiving/scrap-requests";
import { getSessionContext } from "@/lib/auth";
import { SCRAP_RECEIPT_READERS, SCRAP_RECEIVERS } from "@/lib/foundry/scrap-receiving";

export default async function ScrapRequestsPage() {
  const context = await getSessionContext();
  if (context.dealerId || !(SCRAP_RECEIPT_READERS as readonly string[]).includes(context.role)) redirect("/dashboard");
  return <div className="mx-auto max-w-5xl space-y-5">
    <PageHeader title="Scrap requests" description="What the foundry needs: scrap type, alloy and quantity. Accounts and the factory manager are told of each request."
      actions={<Link href="/foundry/scrap/receipts" className="text-sm font-bold underline">Scrap receipts</Link>} />
    <RequestsWorkspace canRequest={(SCRAP_RECEIVERS as readonly string[]).includes(context.role)} />
  </div>;
}
