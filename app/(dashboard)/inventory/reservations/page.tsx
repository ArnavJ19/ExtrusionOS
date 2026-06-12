import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { formatDate, formatWeight } from "@/lib/utils/format";
import { redirect } from "next/navigation";

export default async function InventoryReservationsPage() {
  const context = await getSessionContext();
  if (!can(context.role, "read", "inventory")) redirect("/dashboard");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profile_stock_reservations")
    .select("id, order_id, configuration_id, reserved_weight_kg, reserved_length_m, status, created_at, released_at, notes, aluminium_profiles(profile_code, profile_name), profile_stock_batches(bundle_number, location), orders(order_number, customers(customer_name, company_name)), profile_stock_consumptions(consumed_weight_kg)")
    .eq("company_id", context.companyId)
    .order("created_at", { ascending: false })
    .limit(300);
  const rows = (data ?? []).map((row: any) => {
    const consumedWeight = (row.profile_stock_consumptions ?? []).reduce((sum: number, item: any) => sum + Number(item.consumed_weight_kg ?? 0), 0);
    return { ...row, consumedWeight, remainingWeight: Math.max(Number(row.reserved_weight_kg ?? 0) - consumedWeight, 0) };
  });
  const activeRows = rows.filter((row: any) => row.remainingWeight > 0 && row.status === "active");
  const activeWeight = activeRows.reduce((sum: number, row: any) => sum + Number(row.remainingWeight ?? 0), 0);
  const consumedWeight = rows.reduce((sum: number, row: any) => sum + Number(row.consumedWeight ?? 0), 0);

  return (
    <div className="space-y-6">
      <div><Link href="/inventory" className="mb-3 inline-flex items-center gap-2 text-sm font-black text-slate-500 transition hover:text-orange"><ArrowLeft className="h-4 w-4" /> Back to Inventory</Link><PageHeader title="Stock Reservations" description="Profile stock reserved against orders from systems BOMs, including consumed and remaining quantities." /></div>
      {error ? <Card className="border-red-200 bg-red-50"><CardContent><p className="font-black text-red-900">Could not load stock reservations.</p><p className="mt-1 text-sm font-semibold text-red-700">{error.message}</p></CardContent></Card> : null}
      <div className="grid gap-3 md:grid-cols-4"><Metric label="Active Reservations" value={String(activeRows.length)} /><Metric label="Reserved Open" value={formatWeight(activeWeight)} /><Metric label="Consumed" value={formatWeight(consumedWeight)} /><Metric label="Total Rows" value={String(rows.length)} highlight /></div>
      <Card className="overflow-hidden border-slate-200 shadow-sm">
        <CardHeader><h2 className="section-title">Reservation Ledger</h2></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="industrial-table min-w-[1160px]">
              <thead><tr><th>Profile</th><th>Order</th><th>Bundle / Location</th><th className="text-right">Reserved kg</th><th className="text-right">Consumed kg</th><th className="text-right">Remaining kg</th><th className="text-right">Reserved m</th><th>Status</th><th>Created</th><th>Released</th><th>Notes</th></tr></thead>
              <tbody>{rows.map((row: any) => <tr key={row.id}><td className="font-black text-slate-950">{row.aluminium_profiles?.profile_code ?? "Profile"}<p className="text-xs font-semibold text-slate-500">{row.aluminium_profiles?.profile_name ?? ""}</p></td><td><Link href={`/orders/${row.order_id}`} className="font-black text-slate-950 hover:text-orange">{row.orders?.order_number ?? "Order"}</Link><p className="text-xs font-semibold text-slate-500">{row.orders?.customers?.company_name ?? row.orders?.customers?.customer_name ?? "Customer"}</p></td><td>{row.profile_stock_batches?.bundle_number ?? "-"}<p className="text-xs font-semibold text-slate-500">{row.profile_stock_batches?.location ?? "No location"}</p></td><td className="text-right font-semibold tabular-nums">{formatWeight(row.reserved_weight_kg)}</td><td className="text-right font-semibold tabular-nums">{formatWeight(row.consumedWeight)}</td><td className="text-right font-black tabular-nums text-slate-950">{formatWeight(row.remainingWeight)}</td><td className="text-right font-semibold tabular-nums">{Number(row.reserved_length_m ?? 0).toFixed(3)}</td><td><Badge value={row.remainingWeight <= 0 ? "consumed" : row.status} /></td><td>{formatDate(row.created_at)}</td><td>{formatDate(row.released_at)}</td><td className="max-w-[280px] text-xs font-semibold leading-5 text-slate-500">{row.notes || "-"}</td></tr>)}{!rows.length ? <tr><td colSpan={11} className="px-4 py-12 text-center font-semibold text-slate-500">No stock reservations found. Reservations are created from a calculated systems BOM after quote/order conversion.</td></tr> : null}</tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return <Card className={highlight ? "border-orange/40" : undefined}><CardContent><p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">{label}</p><p className={`mt-2 text-2xl font-black ${highlight ? "text-orange" : "text-slate-950"}`}>{value}</p></CardContent></Card>;
}
