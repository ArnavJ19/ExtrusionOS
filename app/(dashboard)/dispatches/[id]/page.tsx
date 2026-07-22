import { RecordDetailClient } from "@/components/modules/operations/record-detail-client";
import { DispatchDeliveryWorkflow } from "@/components/modules/dispatch-delivery-workflow";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { formatWeight } from "@/lib/utils/format";
import { redirect } from "next/navigation";

export default async function DispatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSessionContext();
  if (!can(context.role, "read", "dispatches")) redirect("/dashboard");
  const canUpdate = can(context.role, "update", "dispatches");
  return <div className="space-y-6">
    <RecordDetailClient moduleKey="dispatches" context={context} recordId={id} canEdit={false} />
    <DispatchDeliveryPanel dispatchId={id} canUpdate={canUpdate} />
    <DispatchPackingPanel dispatchId={id} />
    <DispatchReservationPanel dispatchId={id} />
  </div>;
}

async function DispatchDeliveryPanel({ dispatchId, canUpdate }: { dispatchId: string; canUpdate: boolean }) {
  const context = await getSessionContext();
  const supabase = await createClient();
  const [dispatchResult, historyResult] = await Promise.all([
    supabase
      .from("dispatches")
      .select("id, dispatch_number, delivery_status, proof_of_delivery_url, remarks, last_status_changed_at, delivered_at")
      .eq("company_id", context.companyId)
      .eq("id", dispatchId)
      .maybeSingle(),
    supabase
      .from("dispatch_status_history")
      .select("id, from_status, to_status, changed_at, remarks")
      .eq("company_id", context.companyId)
      .eq("dispatch_id", dispatchId)
      .order("changed_at", { ascending: false })
      .limit(12)
  ]);
  if (dispatchResult.error || !dispatchResult.data) return null;

  return (
    <DispatchDeliveryWorkflow
      dispatch={dispatchResult.data as any}
      history={(historyResult.data ?? []) as any}
      canUpdate={canUpdate}
      companyId={context.companyId}
      userId={context.userId}
    />
  );
}

async function DispatchPackingPanel({ dispatchId }: { dispatchId: string }) {
  const context = await getSessionContext();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("packing_list_items")
    .select("id, bundle_number, number_of_pieces, gross_weight_kg, tare_weight_kg, net_weight_kg, source_kind, reservation_id, profile_stock_batch_id, aluminium_profiles(profile_code, profile_name), stock_batch:profile_stock_batches(bundle_number, location)")
    .eq("company_id", context.companyId)
    .eq("dispatch_id", dispatchId)
    .order("bundle_number", { ascending: true });
  if (error || !data?.length) return null;

  const grossWeight = data.reduce((sum: number, row: any) => sum + Number(row.gross_weight_kg ?? 0), 0);
  const tareWeight = data.reduce((sum: number, row: any) => sum + Number(row.tare_weight_kg ?? 0), 0);
  const netWeight = data.reduce((sum: number, row: any) => sum + Number(row.net_weight_kg ?? 0), 0);
  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader><h2 className="section-title">Physical Bundle Manifest</h2></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm font-medium text-slate-500">{data.length} traceable bundles: {formatWeight(grossWeight)} gross, {formatWeight(tareWeight)} tare, and {formatWeight(netWeight)} net aluminium.</p>
        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="industrial-table min-w-[980px]"><thead><tr><th>Bundle</th><th>Profile</th><th>Source</th><th>Stock Batch</th><th className="text-right">Pieces</th><th className="text-right">Gross</th><th className="text-right">Tare</th><th className="text-right">Net</th></tr></thead><tbody>{data.map((row: any) => <tr key={row.id}><td className="font-black text-slate-950">{row.bundle_number}</td><td>{row.aluminium_profiles?.profile_code ?? "Profile"}<p className="text-xs font-semibold text-slate-500">{row.aluminium_profiles?.profile_name ?? ""}</p></td><td><Badge value={row.source_kind ?? "legacy"} />{row.reservation_id ? <p className="mt-1 text-xs font-semibold text-slate-500">Reservation linked</p> : null}</td><td>{row.stock_batch?.bundle_number ?? "-"}<p className="text-xs font-semibold text-slate-500">{row.stock_batch?.location ?? ""}</p></td><td className="text-right font-semibold tabular-nums">{Number(row.number_of_pieces ?? 0).toLocaleString("en-IN")}</td><td className="text-right font-semibold tabular-nums">{formatWeight(row.gross_weight_kg)}</td><td className="text-right font-semibold tabular-nums">{formatWeight(row.tare_weight_kg)}</td><td className="text-right font-black tabular-nums text-slate-950">{formatWeight(row.net_weight_kg)}</td></tr>)}</tbody></table>
        </div>
      </CardContent>
    </Card>
  );
}

async function DispatchReservationPanel({ dispatchId }: { dispatchId: string }) {
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

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader><h2 className="section-title">Reserved Stock Consumption</h2></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div><p className="text-sm font-black text-slate-950">{activeReservations.length ? `${formatWeight(activeWeight)} reserved stock is active for this order.` : "No active stock reservations for this order."}</p><p className="mt-1 text-sm font-medium text-slate-500">Each dispatched bundle now carries its exact reservation and stock-batch provenance. Consumption is posted automatically with the dispatch, and a fully consumed reservation reduces its batch before the stock can become available again.</p></div>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="industrial-table min-w-[860px]"><thead><tr><th>Profile</th><th>Bundle</th><th className="text-right">Reserved kg</th><th className="text-right">Consumed kg</th><th className="text-right">Remaining kg</th><th className="text-right">Reserved m</th><th>Status</th></tr></thead><tbody>{rows.map((row: any) => <tr key={row.id}><td className="font-black text-slate-950">{row.aluminium_profiles?.profile_code ?? "Profile"}<p className="text-xs font-semibold text-slate-500">{row.aluminium_profiles?.profile_name ?? ""}</p></td><td>{row.profile_stock_batches?.bundle_number ?? "-"}</td><td className="text-right font-semibold tabular-nums">{formatWeight(row.reserved_weight_kg)}</td><td className="text-right font-semibold tabular-nums">{formatWeight(row.consumedWeight)}</td><td className="text-right font-black tabular-nums text-slate-950">{formatWeight(row.remainingWeight)}</td><td className="text-right font-semibold tabular-nums">{Number(row.reserved_length_m ?? 0).toFixed(3)}</td><td><Badge value={row.status} /></td></tr>)}{!rows.length ? <tr><td colSpan={7} className="px-4 py-10 text-center font-semibold text-slate-500">No reservations created for this order yet.</td></tr> : null}</tbody></table>
        </div>
      </CardContent>
    </Card>
  );
}
