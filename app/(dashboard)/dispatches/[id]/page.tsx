import { RecordDetailClient } from "@/components/modules/operations/record-detail-client";
import { DispatchDeliveryWorkflow } from "@/components/modules/dispatch-delivery-workflow";
import { DispatchCreditNoteClient } from "@/components/modules/dispatch-credit-note-client";
import { CustomerRefundForm } from "@/components/modules/financials/customer-refund-form";
import { getBusinessDateBoundaries } from "@/lib/utils/business-date";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatWeight } from "@/lib/utils/format";
import { getReservationLedgerOptions, loadDispatchReservationLedgerPage, type DispatchReservationLedgerPage } from "@/lib/inventory/reservation-ledger";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function DispatchDetailPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const context = await getSessionContext();
  if (!can(context.role, "read", "dispatches")) redirect("/dashboard");
  const canUpdate = can(context.role, "update", "dispatches");
  const query = await searchParams ?? {};
  const reservationPage = getReservationLedgerOptions({ page: query.reservationPage }).page;
  return <div className="space-y-6">
    <RecordDetailClient moduleKey="dispatches" context={context} recordId={id} canEdit={false} />
    <DispatchDeliveryPanel dispatchId={id} canUpdate={canUpdate} />
    <DispatchPackingPanel dispatchId={id} />
    <DispatchReservationPanel dispatchId={id} page={reservationPage} />
    <DispatchCreditNotePanel dispatchId={id} />
  </div>;
}

async function DispatchCreditNotePanel({ dispatchId }: { dispatchId: string }) {
  const context = await getSessionContext();
  if (!can(context.role, "read", "financials")) return null;
  const supabase = await createClient();
  const [dispatchResult, invoiceResult, creditResult] = await Promise.all([
    supabase.from("dispatches").select("delivery_status").eq("company_id", context.companyId).eq("id", dispatchId).maybeSingle(),
    supabase.from("invoices").select("id, invoice_number, grand_total, amount_paid, credited_amount, customer_credit_due, status").eq("company_id", context.companyId).eq("dispatch_id", dispatchId).neq("status", "cancelled").maybeSingle(),
    supabase.from("credit_notes").select("id, credit_note_number, grand_total, status, reason, reversal_reason").eq("company_id", context.companyId).eq("dispatch_id", dispatchId).order("created_at", { ascending: false }).limit(1).maybeSingle()
  ]);
  if (dispatchResult.error || !dispatchResult.data) return null;
  const invoice = invoiceResult.data;
  const creditNote = creditResult.data;
  const canManage = can(context.role, "create", "financials");
  return <div className="space-y-4">
    <DispatchCreditNoteClient dispatchId={dispatchId} deliveryStatus={dispatchResult.data.delivery_status} invoice={(invoice ?? null) as any} creditNote={(creditNote ?? null) as any} canManage={canManage} />
    {canManage && invoice && Number(invoice.customer_credit_due ?? 0) > 0 ? <CustomerRefundForm invoiceId={invoice.id} creditDue={Number(invoice.customer_credit_due)}
      creditNoteId={creditNote?.status === "issued" ? creditNote.id : null} today={getBusinessDateBoundaries().today} /> : null}
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

async function DispatchReservationPanel({ dispatchId, page }: { dispatchId: string; page: number }) {
  const context = await getSessionContext();
  if (!can(context.role, "read", "dispatches") || !can(context.role, "read", "inventory_reservations")) return null;
  const supabase = await createClient();
  const pageHref = (value: number) => `/dispatches/${encodeURIComponent(dispatchId)}?reservationPage=${value}#stock-reservations`;
  let result: DispatchReservationLedgerPage | null = null;
  try { result = await loadDispatchReservationLedgerPage(supabase, dispatchId, page); } catch {
    // Missing or invalid evidence cannot establish zero stock commitments.
  }
  if (!result) return <Card id="stock-reservations" className="border-slate-200 shadow-sm">
    <CardHeader><h2 className="section-title">Dispatch reservations are unavailable</h2></CardHeader>
    <CardContent><p role="alert" className="text-sm font-medium text-slate-600">Reservation quantities for the source order could not be verified. Retry after its data and database connection are restored.</p>
      <Link href={pageHref(page)} className="mt-3 inline-block text-sm font-semibold text-orange">Retry loading reservations</Link></CardContent>
  </Card>;
  if (!result.ledger || !result.order_id) return <Card id="stock-reservations" className="border-slate-200 shadow-sm">
    <CardHeader><h2 className="section-title">Order reservation ledger</h2></CardHeader>
    <CardContent><p className="text-sm font-medium text-slate-600">No source order is linked to this dispatch. Link the correct order before reviewing its reservation quantities.</p></CardContent>
  </Card>;
  const ledger = result.ledger;

  return (
    <Card id="stock-reservations" className="min-w-0 overflow-hidden border-slate-200 shadow-sm">
      <CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><h2 className="section-title">Order reservation ledger</h2>
        <Link href="/inventory/reservations" className="text-sm font-semibold text-orange">Open inventory ledger</Link></div>
        <p className="mt-2 text-sm text-slate-500">Totals cover the source order across all dispatches. <Link className="font-semibold text-slate-700 hover:text-orange" href={`/orders/${result.order_id}`}>Order {result.order_number ?? result.order_id}</Link></p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <DispatchReservationMetric label="Open holds" value={formatWeight(ledger.summary.open_weight_kg)} detail={`${ledger.summary.active_count.toLocaleString("en-IN")} active reservations`} />
          <DispatchReservationMetric label="Consumed stock" value={formatWeight(ledger.summary.consumed_weight_kg)} detail="Posted consumption for the source order" />
          <DispatchReservationMetric label="Released holds" value={formatWeight(ledger.summary.released_weight_kg)} detail="Unconsumed commitments released or cancelled" />
          <DispatchReservationMetric label="Reservations" value={ledger.total_count.toLocaleString("en-IN")} detail="All source-order records; ten per page" />
        </div>
        <p className="text-sm font-medium text-slate-500">Consumption is posted automatically with the dispatch. Open holds include active, unconsumed quantities. Released holds free commitments; physical returns require a recorded receipt. Lifecycle status stays as recorded.</p>
        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="industrial-table min-w-[1100px]"><thead><tr><th>Profile</th><th>Bundle / location</th><th>Reserved</th><th>Consumed</th><th>Open hold</th><th>Released hold</th><th>Status</th></tr></thead>
            <tbody>{ledger.rows.map(row => <tr key={row.id} data-reservation-id={row.id}>
              <td className="font-black text-slate-950">{row.profile_code ?? "Profile unavailable"}<p className="text-xs font-semibold text-slate-500">{row.profile_name ?? ""}</p></td>
              <td>{row.bundle_number ?? "Bundle unavailable"}<p className="text-xs text-slate-500">{row.location ?? "No location"}</p></td>
              <td><DispatchReservationQuantity weight={row.reserved_weight_kg} length={row.reserved_length_m} pieces={row.reserved_pieces} /></td>
              <td><DispatchReservationQuantity weight={row.consumed_weight_kg} length={row.consumed_length_m} pieces={row.consumed_pieces} /></td>
              <td><DispatchReservationQuantity weight={row.open_weight_kg} length={row.open_length_m} pieces={row.open_pieces} /></td>
              <td><DispatchReservationQuantity weight={row.released_weight_kg} length={row.released_length_m} pieces={row.released_pieces} /></td>
              <td><Badge value={row.status} />{row.released_at ? <p className="mt-2 text-xs text-slate-500">{row.status === "consumed" ? "Closed" : "Released"} {formatDate(row.released_at)}</p> : null}</td>
            </tr>)}{!ledger.rows.length ? <tr><td colSpan={7} className="px-4 py-10 text-center font-semibold text-slate-500">No reservations are recorded for this source order.</td></tr> : null}</tbody>
          </table>
        </div>
        <nav aria-label="Dispatch reservation pages" className="flex flex-wrap items-center justify-between gap-3 text-sm font-semibold text-slate-600">
          <p>Page {ledger.page} of {Math.max(1, Math.ceil(ledger.total_count / 10))}</p><div className="flex gap-3">
            {ledger.page > 1 ? <Link href={pageHref(ledger.page - 1)} className="rounded-lg border border-slate-200 px-3 py-2">Previous</Link> : null}
            {ledger.page * 10 < ledger.total_count ? <Link href={pageHref(ledger.page + 1)} className="rounded-lg border border-slate-200 px-3 py-2">Next</Link> : null}
          </div>
        </nav>
      </CardContent>
    </Card>
  );
}

function DispatchReservationQuantity({ weight, length, pieces }: { weight: number; length: number | null; pieces: number | null }) {
  return <div className="whitespace-nowrap tabular-nums"><p className="font-semibold">{formatWeight(weight)}</p>
    <p className="mt-1 text-xs text-slate-500">{pieces === null ? "Pieces not captured" : `${pieces.toLocaleString("en-IN")} pieces`}</p>
    <p className="text-xs text-slate-500">{length === null ? "Metres not captured" : `${length.toFixed(3)} m`}</p></div>;
}

function DispatchReservationMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="min-w-0 rounded-xl bg-slate-50 p-3"><p className="text-xs font-bold uppercase text-slate-500">{label}</p>
    <p className="mt-1 break-words text-xl font-black text-slate-950">{value}</p><p className="mt-1 text-xs text-slate-500">{detail}</p></div>;
}
