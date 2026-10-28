import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { ErrorState } from "@/components/ui/error-state";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { formatDate, formatWeight } from "@/lib/utils/format";
import { labelize } from "@/types/app";
import { ErpControlPanel } from "@/components/modules/erp-control-panel";
import { stockQcControls } from "@/lib/workflow/erp-control-panels";
import { getReservationLedgerOptions, loadReservationLedgerPage, reservationSorts, reservationStatuses, type ReservationLedgerPage } from "@/lib/inventory/reservation-ledger";
import { redirect } from "next/navigation";

export default async function InventoryReservationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = await getSessionContext();
  if (!can(context.role, "read", "inventory_reservations")) redirect("/inventory");
  const options = getReservationLedgerOptions(await searchParams);
  const supabase = await createClient();
  let ledger: ReservationLedgerPage | null = null;
  try {
    ledger = await loadReservationLedgerPage(supabase, options);
  } catch {
    // A failed or incomplete ledger cannot establish zero stock commitments.
  }
  const qcControls = await stockQcControls(supabase, context);
  const pageHref = (page: number) => `/inventory/reservations?${new URLSearchParams({
    page: String(page), q: options.search, status: options.status, sort: options.sort, direction: options.direction
  })}`;

  return (
    <div className="space-y-6">
      <div><Link href="/inventory" className="mb-3 inline-flex items-center gap-2 text-sm font-black text-slate-500 transition hover:text-orange"><ArrowLeft className="h-4 w-4" /> Back to Inventory</Link><Link href="/inventory/stock-balances" className="mb-3 ml-4 inline-flex items-center gap-2 text-sm font-black text-slate-500 transition hover:text-orange">Explain batch balances</Link><PageHeader title="Stock Reservations" description="Trace reserved, consumed and released profile stock against its order. Open holds represent unconsumed commitments; releasing a hold does not add physical stock." /></div>
      <ErpControlPanel title="Finished stock origin and QC hold" actions={qcControls} />
      <form action="/inventory/reservations" className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        <label className="text-xs font-semibold text-slate-600">Search<input name="q" defaultValue={options.search} placeholder="Profile, order, customer or bundle" className="form-input mt-1 block" /></label>
        <label className="text-xs font-semibold text-slate-600">Status<select name="status" defaultValue={options.status} className="form-input mt-1 block"><option value="">All statuses</option>{reservationStatuses.map(status => <option key={status} value={status}>{labelize(status)}</option>)}</select></label>
        <label className="text-xs font-semibold text-slate-600">Sort<select name="sort" defaultValue={options.sort} className="form-input mt-1 block">{reservationSorts.map(sort => <option key={sort} value={sort}>{labelize(sort)}</option>)}</select></label>
        <select aria-label="Sort direction" name="direction" defaultValue={options.direction} className="form-input w-auto"><option value="desc">Descending</option><option value="asc">Ascending</option></select>
        <button className="min-h-11 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Apply</button>
      </form>
      {!ledger ? <><ErrorState title="Reservation ledger is unavailable" description="Its quantities could not be verified. Retry after its data and database connection are restored." /><Link href={pageHref(options.page)} className="text-sm font-semibold text-orange">Retry loading reservations</Link></> : <>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Open holds" value={formatWeight(ledger.summary.open_weight_kg)} detail={`${ledger.summary.active_count.toLocaleString("en-IN")} active reservations`} /><Metric label="Consumed stock" value={formatWeight(ledger.summary.consumed_weight_kg)} detail="Posted consumption across matching records" /><Metric label="Released holds" value={formatWeight(ledger.summary.released_weight_kg)} detail="Unconsumed commitments released or cancelled" /><Metric label="Matching reservations" value={ledger.total_count.toLocaleString("en-IN")} detail="All matches; ten rows per page" /></div>
        <Card className="overflow-hidden border-slate-200 shadow-sm">
          <CardHeader><h2 className="section-title">Reservation Ledger</h2><p className="mt-1 text-sm font-medium text-slate-500">Summary totals cover every matching record. Lifecycle status is retained as recorded.</p></CardHeader>
          <CardContent className="p-0"><div className="overflow-x-auto"><table className="industrial-table min-w-[1320px]">
            <thead><tr><th>Profile</th><th>Order</th><th>Bundle / Location</th><th>Reserved</th><th>Consumed</th><th>Open hold</th><th>Released hold</th><th>Status</th><th>Created / Released</th><th>Notes</th></tr></thead>
            <tbody>{ledger.rows.map(row => <tr key={row.id}>
              <td className="font-black text-slate-950">{row.profile_code ?? "Profile unavailable"}<p className="text-xs font-semibold text-slate-500">{row.profile_name ?? ""}</p></td>
              <td><Link href={`/orders/${row.order_id}`} className="font-black text-slate-950 hover:text-orange">{row.order_number ?? "Open order"}</Link><p className="text-xs font-semibold text-slate-500">{row.customer_name ?? "Customer unavailable"}</p></td>
              <td>{row.bundle_number ?? "Bundle unavailable"}<p className="text-xs font-semibold text-slate-500">{row.location ?? "No location"}</p></td>
              <td><Quantity weight={row.reserved_weight_kg} length={row.reserved_length_m} pieces={row.reserved_pieces} /></td>
              <td><Quantity weight={row.consumed_weight_kg} length={row.consumed_length_m} pieces={row.consumed_pieces} /></td>
              <td><Quantity weight={row.open_weight_kg} length={row.open_length_m} pieces={row.open_pieces} /></td>
              <td><Quantity weight={row.released_weight_kg} length={row.released_length_m} pieces={row.released_pieces} /></td>
              <td><Badge value={row.status} /></td><td>{formatDate(row.created_at)}<p className="text-xs text-slate-500">{formatDate(row.released_at)}</p></td>
              <td className="max-w-[240px] text-xs font-semibold leading-5 text-slate-500">{row.notes || "-"}</td>
            </tr>)}{!ledger.rows.length ? <tr><td colSpan={10} className="px-4 py-12 text-center font-semibold text-slate-500">No reservations match this search or status.</td></tr> : null}</tbody>
          </table></div></CardContent>
        </Card>
        <nav aria-label="Reservation pages" className="flex flex-wrap items-center justify-between gap-3 text-sm font-semibold text-slate-600">
          <p>Page {ledger.page} of {Math.max(1, Math.ceil(ledger.total_count / 10))}</p><div className="flex gap-3">
            {ledger.page > 1 ? <Link href={pageHref(ledger.page - 1)} className="rounded-lg border border-slate-200 px-3 py-2">Previous</Link> : null}
            {ledger.page * 10 < ledger.total_count ? <Link href={pageHref(ledger.page + 1)} className="rounded-lg border border-slate-200 px-3 py-2">Next</Link> : null}
          </div>
        </nav>
      </>}
    </div>
  );
}

function Quantity({ weight, length, pieces }: { weight: number; length: number | null; pieces: number | null }) {
  return <div className="whitespace-nowrap tabular-nums"><p className="font-semibold">{formatWeight(weight)}</p><p className="mt-1 text-xs text-slate-500">{pieces === null ? "Pieces not captured" : `${pieces} pieces`}</p><p className="text-xs text-slate-500">{length === null ? "Metres not captured" : `${length.toFixed(3)} m`}</p></div>;
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <Card><CardContent><p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">{label}</p><p className="mt-2 text-2xl font-black text-slate-950">{value}</p><p className="mt-1 text-xs text-slate-500">{detail}</p></CardContent></Card>;
}
