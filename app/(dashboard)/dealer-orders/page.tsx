import { redirect } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { DealerOrdersOverviewBoard, type DealerOrderOverviewRow } from "@/components/modules/dealer-orders-overview-board";
import { Card, CardContent } from "@/components/ui/card";
import { QueryErrorNotice } from "@/components/ui/query-error-notice";
import { can } from "@/lib/auth/permissions";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils/errors";

export default async function DealerOrdersPage() {
  const context = await getSessionContext();
  if (!can(context.role, "read", "dealer_orders")) redirect("/dashboard");
  const supabase = await getDealerOrdersReadClient();
  const dealerUsersQuery = supabase.from("app_users").select("id, role, dealer_id, dealers(dealer_name)").eq("company_id", context.companyId).in("role", ["dealer_admin", "dealer_staff"]).limit(1000);
  if (context.dealerId) dealerUsersQuery.or(`dealer_id.eq.${context.dealerId},id.eq.${context.userId}`);
  const dealerUsers = await dealerUsersQuery;
  const dealerUsersById = new Map((dealerUsers.data ?? []).map((user: any) => [user.id, { dealer_id: user.dealer_id, dealer_name: dealerName(user.dealers) }]));
  const dealerUserIds = Array.from(dealerUsersById.keys());

  const dealerRequestQuery = supabase.from("dealer_orders").select("id, dealer_id, linked_order_id, order_number, priority, status, expected_delivery_date, factory_committed_date, clarification_required_at, clarification_resolved_at, created_at, dealers(dealer_name)").eq("company_id", context.companyId).order("created_at", { ascending: false }).limit(250);
  const quoteOrderQuery = supabase.from("orders").select("id, dealer_id, created_by, order_number, order_value, priority, current_stage, expected_dispatch_date, created_at, dealers(dealer_name), quotes(quote_number, dealer_id, created_by)").eq("company_id", context.companyId).order("created_at", { ascending: false }).limit(250);
  if (context.dealerId) {
    dealerRequestQuery.eq("dealer_id", context.dealerId);
  }
  const [dealerRequests, quoteOrders] = await Promise.all([dealerRequestQuery, quoteOrderQuery]);
  const linkedOrderIds = new Set((dealerRequests.data ?? []).map((order: any) => order.linked_order_id).filter(Boolean));
  const visibleQuoteOrders = (quoteOrders.data ?? []).filter((order: any) => {
    const quote = Array.isArray(order.quotes) ? order.quotes[0] : order.quotes;
    if (context.dealerId) return order.dealer_id === context.dealerId || order.created_by === context.userId || quote?.dealer_id === context.dealerId || quote?.created_by === context.userId;
    return Boolean(order.dealer_id || quote?.dealer_id || dealerUsersById.has(order.created_by) || (quote?.created_by && dealerUsersById.has(quote.created_by)) || dealerUserIds.length === 0);
  });
  const rows: DealerOrderOverviewRow[] = [
    ...(dealerRequests.data ?? []).map((order: any) => ({ id: order.id, href: `/dealer-orders/${order.id}`, order_number: order.order_number, priority: order.priority, status: order.status, dealer: dealerName(order.dealers), source: "Dealer request", created_at: order.created_at })),
    ...visibleQuoteOrders.filter((order: any) => !linkedOrderIds.has(order.id)).map((order: any) => {
      const quote = Array.isArray(order.quotes) ? order.quotes[0] : order.quotes;
      return { id: order.id, href: `/dealer-orders/quote-orders/${order.id}`, order_number: order.order_number, priority: order.priority, status: mapOrderStage(order.current_stage), dealer: dealerName(order.dealers) === "Dealer" ? dealerUsersById.get(order.created_by)?.dealer_name ?? dealerUsersById.get(quote?.created_by)?.dealer_name ?? "Dealer" : dealerName(order.dealers), source: quote?.quote_number ? `Quote ${quote.quote_number}` : "Quote order", created_at: order.created_at, value: Number(order.order_value ?? 0) };
    })
  ];
  const queryErrors = [dealerUsers.error, dealerRequests.error, quoteOrders.error].filter(Boolean).map((error) => getErrorMessage(error));
  const statuses = ["dealer_order_submitted", "accepted_by_factory", "production_scheduled", "in_production", "packed", "dispatched", "pending_dealer_count", "discrepancy_reported", "closed", "cancelled"];
  const today = new Date().toISOString().slice(0, 10);
  const nativeRows = dealerRequests.data ?? [];
  const delayedRows = nativeRows.filter((order: any) => order.factory_committed_date && order.factory_committed_date < today && !["closed", "cancelled", "delivered_to_dealer", "received_confirmed"].includes(order.status));
  const clarificationRows = nativeRows.filter((order: any) => order.clarification_required_at && !order.clarification_resolved_at);

  return (
    <div>
      <PageHeader title="Dealer Orders" description="Dealer-to-factory order workflow with factory acceptance, production handoff, dispatch, shipment receipt, and reconciliation status." actions={<div className="flex gap-2"><Link href="/dealer-orders/new" className="rounded-2xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm">Create Order</Link><Link href="/dealer-orders/database" className="rounded-2xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold shadow-sm">View Database</Link></div>} />
      <QueryErrorNotice messages={queryErrors} />
      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <Metric label="Dealer Orders" value={String(rows.length)} />
        <Metric label="In Production" value={String(rows.filter((row) => row.status === "in_production").length)} />
        <Metric label="Pending Receipt" value={String(rows.filter((row) => ["dispatched", "pending_dealer_count"].includes(row.status)).length)} />
        <Metric label="Closed" value={String(rows.filter((row) => row.status === "closed").length)} />
      </div>
      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <Card><CardContent><h2 className="section-title">Delayed Dealer Orders</h2><p className="mt-2 text-sm font-semibold text-neutral-500">{delayedRows.length} order{delayedRows.length === 1 ? "" : "s"} past factory committed ETA.</p></CardContent></Card>
        <Card><CardContent><h2 className="section-title">Needs Dealer Clarification</h2><p className="mt-2 text-sm font-semibold text-neutral-500">{clarificationRows.length} order{clarificationRows.length === 1 ? "" : "s"} waiting for dealer response.</p></CardContent></Card>
      </div>
      <DealerOrdersOverviewBoard statuses={statuses} records={rows} />
    </div>
  );
}

async function getDealerOrdersReadClient() {
  return createClient();
}

function Metric({ label, value }: { label: string; value: string }) {
  return <Card><CardContent><p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-400">{label}</p><p className="mt-2 text-2xl font-black text-neutral-950">{value}</p></CardContent></Card>;
}

function mapOrderStage(stage: string) {
  if (["order_confirmed", "die_ready", "billet_ready"].includes(stage)) return "accepted_by_factory";
  if (["extrusion_planned", "billet_heating", "extruded", "stretching", "cutting", "aging", "surface_treatment", "finishing"].includes(stage)) return "in_production";
  if (stage === "packing") return "packed";
  if (stage === "dispatched") return "dispatched";
  if (["delivered", "closed", "payment_pending"].includes(stage)) return "closed";
  if (stage === "cancelled") return "cancelled";
  return "dealer_order_submitted";
}

function dealerName(dealers: { dealer_name?: string } | { dealer_name?: string }[] | null) {
  if (Array.isArray(dealers)) return dealers[0]?.dealer_name ?? "Dealer";
  return dealers?.dealer_name ?? "Dealer";
}
