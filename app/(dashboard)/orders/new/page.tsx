import { QuoteOrderFormClient } from "@/components/modules/orders/quote-order-form-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";
import Link from "next/link";
import { DirectOrderFormClient } from "@/components/modules/orders/direct-order-form-client";
import { canCreateDirectOrder } from "@/lib/orders/direct-order";
import { SystemOrderForm } from "@/components/modules/autopilot-batch10/systems-order";
import { systemOrderDraftAction } from "@/lib/actions/autopilot-batch10";

export default async function NewOrderPage({ searchParams }: { searchParams: Promise<{ source?: string; quoteId?: string; system?: string }> }) {
  const context = await getSessionContext();
  if (!can(context.role, "create", "orders")) redirect("/orders");
  const query = await searchParams;
  const direct = query.source === "direct";
  const allowed = canCreateDirectOrder(context.role, context.dealerId);
  // AP-070: a configurator project opened as a direct order (lines of stock lengths; sales enters the rates).
  const systemId = direct && allowed && typeof query.system === "string" && /^[0-9a-f-]{36}$/i.test(query.system) ? query.system : null;
  const system = systemId ? await systemOrderDraftAction(systemId) : null;
  return <div className="space-y-6">
    <nav aria-label="Order entry method" className="grid gap-3 sm:grid-cols-2">
      <Link href={query.quoteId ? `/orders/new?quoteId=${encodeURIComponent(query.quoteId)}` : "/orders/new"}
        aria-current={!direct ? "page" : undefined} className={`rounded-2xl border p-4 ${!direct ? "border-orange bg-orange/5" : "border-slate-200 bg-white"}`}>
        <span className="font-bold text-slate-950">From approved quotation</span><span className="mt-1 block text-sm text-slate-600">Use approved prices and quote lines, with dealer stock fulfillment where applicable.</span>
      </Link>
      <Link href="/orders/new?source=direct" aria-current={direct ? "page" : undefined}
        className={`rounded-2xl border p-4 ${direct ? "border-orange bg-orange/5" : "border-slate-200 bg-white"}`}>
        <span className="font-bold text-slate-950">Direct priced order</span><span className="mt-1 block text-sm text-slate-600">Enter customer, profile quantities and agreed prices without a quotation.</span>
      </Link>
    </nav>
    {direct ? allowed ? system ? system.success ? <SystemOrderForm prefill={system.data} />
        : <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{system.error}</p> : <DirectOrderFormClient /> : <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Direct priced orders require an owner, admin or sales role. Ask an authorised commercial user to enter the agreed prices.</p>
      : <QuoteOrderFormClient context={context} />}
  </div>;
}
