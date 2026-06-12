import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { QueryErrorNotice } from "@/components/ui/query-error-notice";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { getErrorMessage } from "@/lib/utils/errors";

export default async function DealerOrdersDatabasePage() {
  const context = await getSessionContext();
  if (!can(context.role, "read", "dealer_orders")) redirect("/dashboard");
  const supabase = await getDealerOrdersReadClient();
  const dealerUsers = await supabase.from("app_users").select("id, role, dealer_id").eq("company_id", context.companyId).in("role", ["dealer_admin", "dealer_staff"]).limit(1000);
  const dealerUserIds = new Set((dealerUsers.data ?? []).map((user: any) => user.id));
  const nativeQuery = supabase
    .from("dealer_orders")
    .select("id, linked_order_id, order_number, priority, status, expected_delivery_date, created_at, dealers(dealer_name)")
    .eq("company_id", context.companyId)
    .order("created_at", { ascending: false })
    .limit(100);
  const query = supabase
    .from("orders")
    .select("id, dealer_id, created_by, order_number, order_value, priority, current_stage, order_date, expected_dispatch_date, created_at, dealers(dealer_name), customers(customer_name, company_name), quotes(quote_number, dealer_id, created_by)")
    .eq("company_id", context.companyId)
    .not("dealer_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(100);
  if (context.dealerId) {
    nativeQuery.eq("dealer_id", context.dealerId);
  }
  const [nativeResult, result] = await Promise.all([nativeQuery, query]);
  const linkedOrderIds = new Set((nativeResult.data ?? []).map((order: any) => order.linked_order_id).filter(Boolean));
  const visibleQuoteOrders = (result.data ?? []).filter((order: any) => {
    const quote = Array.isArray(order.quotes) ? order.quotes[0] : order.quotes;
    if (context.dealerId) return order.dealer_id === context.dealerId || order.created_by === context.userId || quote?.dealer_id === context.dealerId || quote?.created_by === context.userId;
    return Boolean(order.dealer_id || quote?.dealer_id || dealerUserIds.has(order.created_by) || (quote?.created_by && dealerUserIds.has(quote.created_by)) || dealerUserIds.size === 0);
  });

  return (
    <div>
      <PageHeader title="Dealer Order Database" description="All quote-converted dealer orders with dealer, customer, status, value, and dispatch details." actions={<Link href="/dealer-orders/new" className="rounded-2xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm">Create Dealer Order</Link>} />
      <QueryErrorNotice messages={[nativeResult.error, result.error, dealerUsers.error].filter(Boolean).map((error) => getErrorMessage(error))} />
      <Card><CardContent><div className="overflow-x-auto"><table className="industrial-table min-w-[1040px]"><thead><tr>{["Order", "Dealer", "Customer", "Quote", "Stage", "Priority", "Value", "Expected"].map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{(nativeResult.data ?? []).map((order: any) => <tr key={`native-${order.id}`}><td><Link className="font-black text-neutral-950 hover:underline" href={`/dealer-orders/${order.id}`}>{order.order_number}</Link><p className="text-xs font-semibold text-neutral-400">{formatDate(order.created_at)}</p></td><td>{dealerName(order.dealers)}</td><td>-</td><td>{order.linked_order_id ? "Linked quote order" : "Manual dealer order"}</td><td><Badge value={order.status} /></td><td><Badge value={order.priority} /></td><td className="font-black">-</td><td>{formatDate(order.expected_delivery_date)}</td></tr>)}{visibleQuoteOrders.filter((order: any) => !linkedOrderIds.has(order.id)).map((order: any) => { const quote = Array.isArray(order.quotes) ? order.quotes[0] : order.quotes; return <tr key={`quote-${order.id}`}><td><Link className="font-black text-neutral-950 hover:underline" href={`/dealer-orders/quote-orders/${order.id}`}>{order.order_number}</Link><p className="text-xs font-semibold text-neutral-400">{formatDate(order.order_date)}</p></td><td>{dealerName(order.dealers)}</td><td>{order.customers?.company_name || order.customers?.customer_name || "Customer"}</td><td>{quote?.quote_number ?? "-"}</td><td><Badge value={order.current_stage} /></td><td><Badge value={order.priority} /></td><td className="font-black">{formatCurrency(order.order_value)}</td><td>{formatDate(order.expected_dispatch_date)}</td></tr>; })}{!(nativeResult.data?.length || visibleQuoteOrders.length) ? <tr><td colSpan={8} className="px-4 py-12 text-center font-semibold text-neutral-500">No dealer orders found.</td></tr> : null}</tbody></table></div></CardContent></Card>
    </div>
  );
}

async function getDealerOrdersReadClient() {
  return createClient();
}

function dealerName(dealers: { dealer_name?: string } | { dealer_name?: string }[] | null) {
  if (Array.isArray(dealers)) return dealers[0]?.dealer_name ?? "Dealer";
  return dealers?.dealer_name ?? "Dealer";
}
