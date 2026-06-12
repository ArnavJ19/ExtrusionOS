import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, formatDate, formatWeight } from "@/lib/utils/format";

export default async function DealerQuoteOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await getSessionContext();
  if (!can(context.role, "read", "dealer_orders")) redirect("/dashboard");
  const { id } = await params;
  const supabase = await createClient();
  const { data: order } = await supabase
    .from("orders")
    .select("*, dealers(dealer_name, dealer_code), customers(customer_name, company_name), quotes(quote_number), order_stage_history(id, stage, changed_at, remarks), order_dealer_stock_fulfillments(id, fulfilled_weight_kg, fulfilled_length_m, created_at, aluminium_profiles(profile_code, profile_name)), dispatches(id, dispatch_number, dispatch_date, delivery_status, total_weight_kg)")
    .eq("id", id)
    .eq("company_id", context.companyId)
    .single();
  if (!order || !order.dealer_id || (context.dealerId && order.dealer_id !== context.dealerId)) notFound();

  return (
    <div className="space-y-6">
      <PageHeader title={`Dealer Order ${order.order_number}`} description={`${order.dealers?.dealer_name ?? "Dealer"} · ${order.customers?.company_name || order.customers?.customer_name || "Customer"}`} actions={<Link href="/dealer-orders/database" className="rounded-2xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold shadow-sm">View Database</Link>} />
      <div className="grid gap-6 lg:grid-cols-4">
        <Metric label="Stage" value={order.current_stage} badge />
        <Metric label="Order Value" value={formatCurrency(order.order_value)} />
        <Metric label="Dealer Stock Used" value={formatWeight(order.dealer_fulfilled_weight_kg ?? 0)} />
        <Metric label="Factory Balance" value={formatWeight(order.manufacturing_weight_kg ?? 0)} />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card><CardHeader><h2 className="text-lg font-bold">Timeline</h2></CardHeader><CardContent><div className="space-y-3">{(order.order_stage_history ?? []).map((row: any) => <div key={row.id} className="rounded-2xl border border-neutral-200 p-4"><Badge value={row.stage} /><p className="mt-2 text-sm font-medium text-neutral-500">{row.remarks ?? "No remarks"}</p><p className="mt-1 text-xs font-bold text-neutral-400">{formatDate(row.changed_at)}</p></div>)}</div></CardContent></Card>
        <Card><CardHeader><h2 className="text-lg font-bold">Dispatches</h2></CardHeader><CardContent><div className="space-y-3">{(order.dispatches ?? []).map((row: any) => <div key={row.id} className="rounded-2xl border border-neutral-200 p-4"><div className="flex items-center justify-between"><p className="font-bold">{row.dispatch_number ?? "Dispatch"}</p><Badge value={row.delivery_status} /></div><p className="mt-2 text-sm text-neutral-500">{formatDate(row.dispatch_date)} · {formatWeight(row.total_weight_kg ?? 0)}</p></div>)}{!order.dispatches?.length ? <p className="empty-mini">No dispatches yet.</p> : null}</div></CardContent></Card>
      </div>
      <Card><CardHeader><h2 className="text-lg font-bold">Dealer Stock Fulfillment</h2></CardHeader><CardContent><div className="overflow-x-auto"><table className="industrial-table min-w-[760px]"><thead><tr><th>Profile</th><th>Weight</th><th>Length</th><th>Created</th></tr></thead><tbody>{(order.order_dealer_stock_fulfillments ?? []).map((row: any) => <tr key={row.id}><td>{row.aluminium_profiles?.profile_code ?? "Profile"}<p className="text-xs text-neutral-500">{row.aluminium_profiles?.profile_name ?? ""}</p></td><td>{formatWeight(row.fulfilled_weight_kg)}</td><td>{Number(row.fulfilled_length_m ?? 0).toFixed(3)} m</td><td>{formatDate(row.created_at)}</td></tr>)}</tbody></table></div></CardContent></Card>
    </div>
  );
}

function Metric({ label, value, badge }: { label: string; value: string; badge?: boolean }) {
  return <Card><CardContent><p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-400">{label}</p><div className="mt-2 text-xl font-black text-neutral-950">{badge ? <Badge value={value} /> : value}</div></CardContent></Card>;
}
