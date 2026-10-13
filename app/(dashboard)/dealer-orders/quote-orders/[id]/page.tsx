import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { QueryErrorNotice } from "@/components/ui/query-error-notice";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, formatDate, formatWeight } from "@/lib/utils/format";
import { getErrorMessage } from "@/lib/utils/errors";

export default async function DealerQuoteOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await getSessionContext();
  if (!can(context.role, "read", "dealer_orders")) redirect("/dashboard");
  const { id } = await params;
  const supabase = await createClient();
  const { data: order, error: orderError } = await supabase
    .from("orders_authorized")
    .select("*")
    .eq("id", id)
    .eq("company_id", context.companyId)
    .single();
  if (!order || !order.dealer_id || (context.dealerId && order.dealer_id !== context.dealerId)) notFound();

  const [historyResult, dispatchResult, fulfillmentResult] = await Promise.all([
    supabase.from("order_stage_history").select("id, stage, changed_at, remarks").eq("company_id", context.companyId).eq("order_id", id).order("changed_at", { ascending: false }),
    supabase.from("dispatches").select("id, dispatch_number, dispatch_date, delivery_status, total_weight_kg").eq("company_id", context.companyId).eq("order_id", id).order("dispatch_date", { ascending: false }),
    supabase.from("order_dealer_stock_fulfillments_authorized").select("id, quote_item_id, profile_id, finishing_type, unit_rate, fulfilled_weight_kg, fulfilled_length_m, created_at").eq("company_id", context.companyId).eq("order_id", id).order("created_at", { ascending: false }),
  ]);
  const fulfillments = fulfillmentResult.data ?? [];
  const profileIds = [...new Set(fulfillments.map((row: any) => row.profile_id).filter(Boolean))];
  const quoteItemIds = [...new Set(fulfillments.map((row: any) => row.quote_item_id).filter(Boolean))];
  const [profilesResult, quoteItemsResult] = await Promise.all([
    profileIds.length ? supabase.from("aluminium_profiles").select("id, profile_code, profile_name").eq("company_id", context.companyId).in("id", profileIds) : { data: [], error: null },
    quoteItemIds.length ? supabase.from("quote_items_authorized").select("id, item_description").eq("company_id", context.companyId).in("id", quoteItemIds) : { data: [], error: null },
  ]);
  const profilesById = new Map((profilesResult.data ?? []).map((row: any) => [row.id, row]));
  const quoteItemsById = new Map((quoteItemsResult.data ?? []).map((row: any) => [row.id, row]));
  const orderHistory = historyResult.data ?? [];
  const orderDispatches = dispatchResult.data ?? [];
  const orderFulfillments = fulfillments.map((row: any) => ({
    ...row,
    aluminium_profiles: profilesById.get(row.profile_id) ?? null,
    quote_items: quoteItemsById.get(row.quote_item_id) ?? null,
  }));
  const queryErrors = [orderError, historyResult.error, dispatchResult.error, fulfillmentResult.error, profilesResult.error, quoteItemsResult.error]
    .filter(Boolean).map((error) => getErrorMessage(error));
  const canSeeOrderValue = ["owner", "admin", "sales_manager", "sales", "accounts", "dealer_admin", "dealer_staff"].includes(context.role);

  return (
    <div className="space-y-6">
      <PageHeader title={`Dealer Order ${order.order_number}`} description={`Dealer · ${order.company_name || order.customer_name || "Customer"}`} actions={<Link href="/dealer-orders/database" className="rounded-2xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold shadow-sm">View Database</Link>} />
      <QueryErrorNotice messages={queryErrors} />
      <div className="grid gap-6 lg:grid-cols-4">
        <Metric label="Stage" value={order.current_stage} badge />
        {canSeeOrderValue && order.order_value != null ? <Metric label="Order Value" value={formatCurrency(order.order_value)} /> : null}
        <Metric label="Dealer Stock Used" value={formatWeight(order.dealer_fulfilled_weight_kg ?? 0)} />
        <Metric label="Factory Balance" value={formatWeight(order.manufacturing_weight_kg ?? 0)} />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card><CardHeader><h2 className="text-lg font-bold">Timeline</h2></CardHeader><CardContent><div className="space-y-3">{orderHistory.map((row: any) => <div key={row.id} className="rounded-2xl border border-neutral-200 p-4"><Badge value={row.stage} /><p className="mt-2 text-sm font-medium text-neutral-500">{row.remarks ?? "No remarks"}</p><p className="mt-1 text-xs font-bold text-neutral-400">{formatDate(row.changed_at)}</p></div>)}{!orderHistory.length ? <p className="empty-mini">No stage history yet.</p> : null}</div></CardContent></Card>
        <Card><CardHeader><h2 className="text-lg font-bold">Dispatches</h2></CardHeader><CardContent><div className="space-y-3">{orderDispatches.map((row: any) => <div key={row.id} className="rounded-2xl border border-neutral-200 p-4"><div className="flex items-center justify-between"><p className="font-bold">{row.dispatch_number ?? "Dispatch"}</p><Badge value={row.delivery_status} /></div><p className="mt-2 text-sm text-neutral-500">{formatDate(row.dispatch_date)} · {formatWeight(row.total_weight_kg ?? 0)}</p></div>)}{!orderDispatches.length ? <p className="empty-mini">No dispatches yet.</p> : null}</div></CardContent></Card>
      </div>
      <Card><CardHeader><h2 className="text-lg font-bold">Dealer Stock Fulfillment</h2></CardHeader><CardContent><div className="overflow-x-auto"><table className="industrial-table min-w-[960px]"><thead><tr><th>Profile</th><th>Quote Line</th><th>Finish</th><th>Rate</th><th>Weight</th><th>Length</th><th>Created</th></tr></thead><tbody>{orderFulfillments.map((row: any) => <tr key={row.id}><td>{row.aluminium_profiles?.profile_code ?? "Profile"}<p className="text-xs text-neutral-500">{row.aluminium_profiles?.profile_name ?? ""}</p></td><td>{row.quote_items?.item_description || (row.quote_item_id ? `Linked ${String(row.quote_item_id).slice(0, 8)}` : "Legacy line")}</td><td><Badge value={row.finishing_type ?? "stock"} /></td><td>{row.unit_rate ? `${formatCurrency(row.unit_rate)}/kg` : "-"}</td><td>{formatWeight(row.fulfilled_weight_kg)}</td><td>{Number(row.fulfilled_length_m ?? 0).toFixed(3)} m</td><td>{formatDate(row.created_at)}</td></tr>)}</tbody></table></div></CardContent></Card>
    </div>
  );
}

function Metric({ label, value, badge }: { label: string; value: string; badge?: boolean }) {
  return <Card><CardContent><p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-400">{label}</p><div className="mt-2 text-xl font-black text-neutral-950">{badge ? <Badge value={value} /> : value}</div></CardContent></Card>;
}
