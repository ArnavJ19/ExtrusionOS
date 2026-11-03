import Link from "next/link";
import { orderLedgerAction } from "@/lib/actions/operations-control";
import { canReadControl } from "@/lib/workflow/operations-control";
import { FulfilmentLines } from "@/components/modules/control/fulfilment-lines";
import type { SessionContext } from "@/types/app";

/** NOV-005: the order page's connected fulfilment ledger, read on the server for internal roles. */
export async function OrderFulfilmentLedger({ orderId, context }: { orderId: string; context: SessionContext }) {
  if (context.dealerId || !canReadControl(context.role, "ledger")) return null;
  const result = await orderLedgerAction({ order_id: orderId });
  if (!result.success) return <section aria-label="Order fulfilment ledger" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-950">{result.error}</section>;
  return <div className="space-y-2"><FulfilmentLines ledger={result.data} />
    <Link href={`/tasks/control/ledger/${orderId}`} className="inline-flex min-h-11 items-center text-sm font-bold underline">Open in operational controls</Link></div>;
}
