import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { getBusinessDateBoundaries } from "@/lib/utils/business-date";
import { BankClient } from "@/components/modules/order-to-cash/bank";

// AP-024: bank statement import and receipt matching.
export default async function BankPage() {
  const context = await getSessionContext();
  if (context.dealerId || !["owner", "admin", "accounts"].includes(context.role)) redirect("/payments");
  return <div className="mx-auto max-w-5xl space-y-5">
    <div><p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Payments</p><h1 className="text-2xl font-black">Bank statement</h1>
      <p className="mt-1 max-w-3xl text-sm text-neutral-600">Import the statement; each credit is matched by UTR, remitter, named invoice and amount. Confirm matches; assign an unknown remitter once and it is recognised next time.</p></div>
    <BankClient today={getBusinessDateBoundaries().today} />
  </div>;
}
