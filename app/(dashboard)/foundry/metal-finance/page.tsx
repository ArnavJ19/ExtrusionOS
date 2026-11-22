import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { MetalFinanceQueue } from "@/components/modules/foundry/scrap-receiving/metal-finance";
import { getSessionContext } from "@/lib/auth";
import { METAL_FINANCE_ROLES } from "@/lib/foundry/scrap-receiving";

// Accounts: vendor, bill, rate and tax for scrap and external aluminium received by the foundry.
export default async function MetalFinancePage() {
  const context = await getSessionContext();
  if (context.dealerId || !(METAL_FINANCE_ROLES as readonly string[]).includes(context.role)) redirect("/dashboard");
  return <div className="mx-auto max-w-5xl space-y-5">
    <PageHeader title="Metal bills" description="The foundry records what arrived and its weight; accounts add the vendor, the bill and its values. Saving posts the expense for approval."
      actions={<Link href="/foundry/scrap/receipts?status=finance_pending" className="text-sm font-bold underline">Scrap receipts</Link>} />
    <MetalFinanceQueue companyId={context.companyId} />
  </div>;
}
