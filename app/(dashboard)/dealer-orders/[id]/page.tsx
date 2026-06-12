import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DealerOrderCollaborationClient } from "@/components/modules/dealer-order-collaboration-client";
import { can } from "@/lib/auth/permissions";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function DealerOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await getSessionContext();
  if (!can(context.role, "read", "dealer_orders")) redirect("/dashboard");
  const { id } = await params;
  const supabase = await createClient();
  const { data: order } = await supabase.from("dealer_orders").select("*, dealers(dealer_name, dealer_code)").eq("id", id).eq("company_id", context.companyId).single();
  if (!order || (context.dealerId && order.dealer_id !== context.dealerId)) notFound();
  const [items, history, shipments, comments] = await Promise.all([
    supabase.from("dealer_order_items").select("*").eq("dealer_order_id", id).eq("company_id", context.companyId),
    supabase.from("dealer_order_status_history").select("*").eq("dealer_order_id", id).eq("company_id", context.companyId).order("created_at", { ascending: false }),
    supabase.from("shipments").select("id, shipment_number, status, dispatched_at").eq("dealer_order_id", id).eq("company_id", context.companyId).order("created_at", { ascending: false }),
    supabase.from("dealer_order_comments").select("*").eq("dealer_order_id", id).eq("company_id", context.companyId).order("created_at", { ascending: false })
  ]);

  return (
    <div>
      <PageHeader title={order.order_number} description={`${order.dealers?.dealer_name ?? "Dealer"} order workflow and accountability timeline.`} />
      <div className="grid gap-6 xl:grid-cols-[1.4fr_0.8fr]">
        <Card><CardHeader><h2 className="text-lg font-bold">Requested Items</h2></CardHeader><CardContent><table className="industrial-table min-w-full"><thead><tr><th>Item</th><th>Type</th><th>Quantity</th><th>Finish</th></tr></thead><tbody>{(items.data ?? []).map((item) => <tr key={item.id}><td>{item.item_description}</td><td>{item.item_type}</td><td>{item.quantity} {item.unit}</td><td>{item.finish ?? "-"}</td></tr>)}</tbody></table></CardContent></Card>
        <Card><CardHeader><h2 className="text-lg font-bold">Status</h2></CardHeader><CardContent><Badge value={order.status} /><p className="mt-4 text-sm font-medium text-neutral-500">Priority: {order.priority}</p><p className="mt-1 text-sm font-medium text-neutral-500">Expected: {order.expected_delivery_date ?? "Not set"}</p></CardContent></Card>
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Timeline title="Order Timeline" rows={history.data ?? []} />
        <Card><CardHeader><h2 className="text-lg font-bold">Shipments</h2></CardHeader><CardContent><div className="space-y-3">{(shipments.data ?? []).map((shipment) => <a key={shipment.id} href={`/shipments/${shipment.id}/receipt`} className="block rounded-2xl border border-neutral-200 p-4"><div className="flex justify-between gap-3"><p className="font-bold">{shipment.shipment_number}</p><Badge value={shipment.status} /></div><p className="mt-2 text-sm text-neutral-500">{shipment.dispatched_at ?? "Not dispatched"}</p></a>)}</div></CardContent></Card>
      </div>
      <div className="mt-6"><DealerOrderCollaborationClient context={context} order={order} comments={comments.data ?? []} history={history.data ?? []} /></div>
    </div>
  );
}

function Timeline({ title, rows }: { title: string; rows: Record<string, any>[] }) {
  return <Card><CardHeader><h2 className="text-lg font-bold">{title}</h2></CardHeader><CardContent><div className="space-y-3">{rows.map((row) => <div key={row.id} className="rounded-2xl border border-neutral-200 p-4"><Badge value={row.new_status} /><p className="mt-2 text-sm font-medium text-neutral-500">{row.notes ?? "No notes"}</p><p className="mt-1 text-xs font-bold text-neutral-400">{row.created_at}</p></div>)}</div></CardContent></Card>;
}
