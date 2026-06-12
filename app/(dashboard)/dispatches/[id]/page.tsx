import { RecordDetailClient } from "@/components/modules/operations/record-detail-client";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { consumeDispatchReservations } from "@/lib/actions/stock-reservations";
import { formatWeight } from "@/lib/utils/format";
import { redirect } from "next/navigation";

export default async function DispatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSessionContext();
  if (!can(context.role, "read", "dispatches")) redirect("/dashboard");
  return <div className="space-y-6"><RecordDetailClient moduleKey="dispatches" context={context} recordId={id} canEdit={can(context.role, "update", "dispatches")} /><DispatchReservationPanel dispatchId={id} canConsume={can(context.role, "update", "dispatches") && can(context.role, "update", "inventory")} /></div>;
}

async function DispatchReservationPanel({ dispatchId, canConsume }: { dispatchId: string; canConsume: boolean }) {
  const context = await getSessionContext();
  const supabase = await createClient();
  const dispatchResult = await supabase.from("dispatches").select("order_id, total_weight_kg, delivery_status").eq("company_id", context.companyId).eq("id", dispatchId).single();
  if (dispatchResult.error || !dispatchResult.data) return null;
  const reservationsResult = await supabase
    .from("profile_stock_reservations")
    .select("id, profile_id, reserved_weight_kg, reserved_length_m, status, aluminium_profiles(profile_code, profile_name), profile_stock_batches(bundle_number), profile_stock_consumptions(consumed_weight_kg, dispatch_id)")
    .eq("company_id", context.companyId)
    .eq("order_id", dispatchResult.data.order_id)
    .order("created_at", { ascending: true });
  const reservations = reservationsResult.data ?? [];
  const rows = reservations.map((row: any) => {
    const consumedWeight = (row.profile_stock_consumptions ?? []).reduce((sum: number, item: any) => sum + Number(item.consumed_weight_kg ?? 0), 0);
    return { ...row, consumedWeight, remainingWeight: Math.max(Number(row.reserved_weight_kg ?? 0) - consumedWeight, 0) };
  });
  const activeReservations = rows.filter((row: any) => row.remainingWeight > 0);
  const activeWeight = activeReservations.reduce((sum: number, row: any) => sum + Number(row.remainingWeight ?? 0), 0);
  const consumeAction = consumeDispatchReservations.bind(null, dispatchId);

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader><h2 className="section-title">Reserved Stock Consumption</h2></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div><p className="text-sm font-black text-slate-950">{activeReservations.length ? `${formatWeight(activeWeight)} reserved stock is active for this order.` : "No active stock reservations for this order."}</p><p className="mt-1 text-sm font-medium text-slate-500">Consume reservations after dispatch when dispatch weight covers the reserved stock. Partial dispatches remain blocked to avoid incorrect stock consumption.</p></div>
          {canConsume ? <form action={consumeAction}><button type="submit" disabled={!activeReservations.length || !["dispatched", "in_transit", "delivered"].includes(dispatchResult.data.delivery_status)} className="inline-flex items-center justify-center rounded-xl bg-charcoal px-4 py-2.5 text-sm font-bold text-white transition hover:bg-charcoal/90 disabled:cursor-not-allowed disabled:opacity-50">Consume Reserved Stock</button></form> : null}
        </div>
        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="industrial-table min-w-[860px]"><thead><tr><th>Profile</th><th>Bundle</th><th className="text-right">Reserved kg</th><th className="text-right">Consumed kg</th><th className="text-right">Remaining kg</th><th className="text-right">Reserved m</th><th>Status</th></tr></thead><tbody>{rows.map((row: any) => <tr key={row.id}><td className="font-black text-slate-950">{row.aluminium_profiles?.profile_code ?? "Profile"}<p className="text-xs font-semibold text-slate-500">{row.aluminium_profiles?.profile_name ?? ""}</p></td><td>{row.profile_stock_batches?.bundle_number ?? "-"}</td><td className="text-right font-semibold tabular-nums">{formatWeight(row.reserved_weight_kg)}</td><td className="text-right font-semibold tabular-nums">{formatWeight(row.consumedWeight)}</td><td className="text-right font-black tabular-nums text-slate-950">{formatWeight(row.remainingWeight)}</td><td className="text-right font-semibold tabular-nums">{Number(row.reserved_length_m ?? 0).toFixed(3)}</td><td><Badge value={row.status} /></td></tr>)}{!rows.length ? <tr><td colSpan={7} className="px-4 py-10 text-center font-semibold text-slate-500">No reservations created for this order yet.</td></tr> : null}</tbody></table>
        </div>
      </CardContent>
    </Card>
  );
}
