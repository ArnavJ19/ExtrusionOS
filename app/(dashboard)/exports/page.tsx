import { Globe, Ship, Plane, Truck as TruckIcon, Package, FileCheck, DollarSign } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  confirmed: "bg-blue-100 text-blue-800",
  production: "bg-indigo-100 text-indigo-800",
  packing: "bg-amber-100 text-amber-800",
  shipped: "bg-teal-100 text-teal-800",
  in_transit: "bg-purple-100 text-purple-800",
  delivered: "bg-green-100 text-green-800",
  completed: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-red-100 text-red-800"
};

const PAY_COLORS: Record<string, string> = {
  pending: "bg-slate-100 text-slate-700",
  lc_received: "bg-blue-100 text-blue-800",
  advance_received: "bg-teal-100 text-teal-800",
  partial: "bg-amber-100 text-amber-800",
  full: "bg-green-100 text-green-800",
  overdue: "bg-red-100 text-red-800"
};

const SHIP_ICONS: Record<string, typeof Ship> = { sea: Ship, air: Plane, road: TruckIcon, courier: Package };

export default async function ExportsPage() {
  const context = await getSessionContext();
  const supabase = await createClient();
  const { data: orders } = await supabase
    .from("export_orders")
    .select("id, export_customer_name, destination_country, incoterm, port_of_loading, port_of_discharge, shipment_mode, container_number, seal_number, shipping_bill_number, commercial_invoice_number, total_value, currency, payment_status, status, estimated_ship_date, export_documents(document_type, status)")
    .eq("company_id", context.companyId)
    .order("created_at", { ascending: false })
    .limit(100);

  const rows = orders ?? [];
  const stats = {
    active: rows.filter((order: any) => !["delivered", "completed", "cancelled"].includes(order.status)).length,
    totalValue: rows.reduce((sum: number, order: any) => sum + Number(order.total_value ?? 0), 0),
    shipped: rows.filter((order: any) => ["shipped", "in_transit"].includes(order.status)).length,
    docsComplete: rows.filter((order: any) => (order.export_documents ?? []).length && order.export_documents.every((doc: any) => doc.status === "verified")).length
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Export Documentation" description="Manage real export orders, shipping documents, incoterms, container tracking, and payment status." />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Metric label="Active Exports" value={String(stats.active)} icon={Globe} />
        <Metric label="Total Value" value={formatCompactMoney(stats.totalValue)} icon={DollarSign} />
        <Metric label="In Transit" value={String(stats.shipped)} icon={Ship} />
        <Metric label="Docs Complete" value={String(stats.docsComplete)} icon={FileCheck} />
      </div>

      <div className="space-y-3">
        {rows.length ? rows.map((order: any) => {
          const ShipIcon = SHIP_ICONS[order.shipment_mode] || Ship;
          const docs = order.export_documents ?? [];
          const docsReady = docs.filter((doc: any) => doc.status === "verified").length;
          return (
            <Card key={order.id}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Badge value={order.status} className={STATUS_COLORS[order.status] ?? STATUS_COLORS.draft} />
                      <Badge value={order.payment_status} className={PAY_COLORS[order.payment_status] ?? PAY_COLORS.pending} />
                      <Badge value={order.incoterm} />
                    </div>
                    <p className="text-sm font-black text-slate-900">{order.export_customer_name}</p>
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                      <ShipIcon className="h-3 w-3" /> {order.port_of_loading || "Port not captured"} → {order.port_of_discharge || "Port not captured"} · {order.destination_country}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-lg font-black text-slate-900">{order.currency} {Number(order.total_value ?? 0).toLocaleString("en-IN")}</p>
                    <p className="text-[10px] text-slate-500">Ship: {order.estimated_ship_date ?? "Not scheduled"}</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-4 text-[10px] text-slate-500">
                  {order.container_number ? <span>Container: {order.container_number}</span> : null}
                  {order.commercial_invoice_number ? <span>Invoice: {order.commercial_invoice_number}</span> : null}
                  <span>Docs: {docsReady}/{docs.length} verified</span>
                </div>
              </CardContent>
            </Card>
          );
        }) : <EmptyState title="No export orders yet" description="Export records will appear after export orders and document packs are created for this company." />}
      </div>
    </div>
  );
}

function Metric({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Globe }) {
  return <Card><CardContent className="p-4"><div className="mb-1 flex items-center gap-2"><div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50"><Icon className="h-3.5 w-3.5 text-blue-600" /></div><p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p></div><p className="mt-1 text-xl font-black text-slate-900">{value}</p></CardContent></Card>;
}

function Badge({ value, className = "bg-slate-100 text-slate-700" }: { value: string; className?: string }) {
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${className}`}>{String(value ?? "-").replace(/_/g, " ")}</span>;
}

function formatCompactMoney(value: number) {
  if (value >= 10000000) return `₹${(value / 10000000).toFixed(1)}Cr`;
  if (value >= 100000) return `₹${(value / 100000).toFixed(1)}L`;
  return `₹${value.toLocaleString("en-IN")}`;
}
