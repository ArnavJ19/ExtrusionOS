import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { LiveRefresh } from "@/components/modules/intelligence/live";
import { ListControls, SortHeader } from "@/components/modules/orchestration/list-controls";
import { getSessionContext } from "@/lib/auth";
import { hasRouteAccess } from "@/lib/auth/route-permissions";
import { deliveryTrackingAction } from "@/lib/actions/orchestration";
import { floorText } from "@/lib/i18n/floor";
import { ACCEPTANCE_LABELS, DELIVERY_SORTS, DELIVERY_VIEWS, SHIPMENT_STATE_LABELS, deliveryBoardSchema, deliverySort, labelOf, pick } from "@/lib/workflow/delivery-closure";

const at = (value: string | null) => (value ? new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const TABS = ["open", "delivery_delayed", "delivery_attempted", "delivered_confirmation_pending", "delivery_disputed", "pod_received", "all"] as const;
const SORT_LABELS: Record<(typeof DELIVERY_SORTS)[number], string> = { dispatched_at: "Dispatched", expected_at: "Expected delivery", dispatch_number: "Dispatch number" };

// Phase 7: delivery monitoring — every dispatch that left in the last 120 days (and any still on the road) by shipment
// state, with the customer acceptance outcome; search, sorting and 10 per page in the database.
export default async function DeliveriesPage({ searchParams }: { searchParams: Promise<{ view?: string; page?: string; q?: string; sort?: string; dir?: string }> }) {
  const [q, context] = await Promise.all([searchParams, getSessionContext()]);
  if (context.dealerId || !hasRouteAccess("/dispatches/deliveries", context.role)) redirect("/dashboard");
  const t = floorText("en");
  const view = pick(DELIVERY_VIEWS, q.view, "open");
  const page = Math.min(Math.max(Number.parseInt(q.page ?? "1", 10) || 1, 1), 100000);
  const search = (q.q ?? "").trim().slice(0, 80);
  const sort = deliverySort(q.sort);
  const direction = q.dir === "asc" || q.dir === "desc" ? q.dir : sort === "dispatch_number" ? "asc" : "desc";
  const result = await deliveryTrackingAction({ command: "board", view, page, sort, direction, ...(search ? { search } : {}) });
  const board = result.success ? deliveryBoardSchema.safeParse(result.data).data ?? null : null;
  const href = (next: { view?: string; page?: number; sort?: string; dir?: string }) => {
    const p = new URLSearchParams();
    p.set("view", next.view ?? view);
    if (search) p.set("q", search);
    p.set("sort", next.sort ?? sort); p.set("dir", next.dir ?? direction);
    if (next.page && next.page > 1) p.set("page", String(next.page));
    return `?${p.toString()}`;
  };
  const count = (v: string) => v === "all" ? Object.values(board?.counts ?? {}).reduce((s, n) => s + n, 0)
    : v === "open" ? ["dispatched", "in_transit", "delivery_delayed", "delivery_attempted", "delivered_confirmation_pending", "delivery_disputed"].reduce((s, k) => s + (board?.counts[k] ?? 0), 0)
    : board?.counts[v] ?? 0;
  return (
    <div className="space-y-5">
      <PageHeader title="Delivery monitoring" description="Every shipment from the gate to the customer's acceptance. A transporter's delivery report is not customer acceptance: record the delivery receipt from the proof of delivery, and the acceptance of each bundle."
        backHref="/dispatches" backLabel="Back to dispatches" actions={<LiveRefresh name="deliveries" tables={["dispatches", "dispatch_tracking_updates", "delivery_receipts"]} />} />
      <nav className="flex flex-wrap gap-2" aria-label="Shipment states">
        {TABS.map(v => <Link key={v} href={href({ view: v })} aria-current={view === v ? "page" : undefined}
          className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-bold ${view === v ? "bg-charcoal text-white" : "border border-slate-300 bg-white"}`}>
          {v === "open" ? "Needs attention" : v === "all" ? "All" : SHIPMENT_STATE_LABELS[v]}<span className="rounded-full bg-slate-100 px-2 text-xs text-slate-800">{count(v)}</span></Link>)}
      </nav>
      <ListControls t={t} search={search} searchHint="Dispatch, order, customer, vehicle or LR" hidden={{ view }} sort={sort} direction={direction} clearHref={`?view=${view}`}
        sorts={DELIVERY_SORTS.map(s => ({ value: s, label: SORT_LABELS[s] }))} />
      {!board ? <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{!result.success ? result.error : "The deliveries could not be read."}</p>
        : board.rows.length === 0 ? <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">No shipment in this state.</p> : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50"><tr>
              <SortHeader t={t} label="Dispatch" field="dispatch_number" sort={sort} direction={direction} href={(s, d) => href({ sort: s, dir: d })} />
              <th scope="col" className="px-3 py-2 font-bold">Order · customer</th>
              <th scope="col" className="px-3 py-2 font-bold">Shipment</th>
              <SortHeader t={t} label="Expected" field="expected_at" sort={sort} direction={direction} href={(s, d) => href({ sort: s, dir: d })} />
              <th scope="col" className="px-3 py-2 font-bold">Acceptance</th>
              <SortHeader t={t} label="Left" field="dispatched_at" sort={sort} direction={direction} href={(s, d) => href({ sort: s, dir: d })} />
            </tr></thead>
            <tbody>{board.rows.map(r => (
              <tr key={r.dispatch_id} className="border-t align-top">
                <td className="px-3 py-2 font-semibold"><Link className="underline" href={`/dispatches/deliveries/${r.dispatch_id}`}>{r.dispatch_number ?? "Dispatch"}</Link><div className="text-xs">{r.vehicle_number ?? "—"}{r.lr_number ? ` · LR ${r.lr_number}` : ""}</div></td>
                <td className="px-3 py-2">{r.order_number ?? "—"}<div className="text-xs">{r.customer ?? "—"}</div></td>
                <td className={`px-3 py-2 font-semibold ${r.state === "delivery_disputed" || r.state === "delivery_delayed" ? "text-red-900" : ""}`}>{SHIPMENT_STATE_LABELS[r.state]}</td>
                <td className={`px-3 py-2 ${r.overdue ? "font-bold text-red-900" : ""}`}>{at(r.expected_at)}{r.overdue ? <div className="text-xs">Overdue</div> : null}</td>
                <td className="px-3 py-2">{labelOf(ACCEPTANCE_LABELS, r.acceptance)}</td>
                <td className="px-3 py-2">{at(r.dispatched_at)}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
      {board && board.total > board.page_size ? <nav className="flex justify-between text-sm font-semibold" aria-label="Pages">
        {page > 1 ? <Link href={href({ page: page - 1 })}>Previous</Link> : <span />}<span>Page {page} of {Math.ceil(board.total / board.page_size)}</span>
        {page * board.page_size < board.total ? <Link href={href({ page: page + 1 })}>Next</Link> : <span />}</nav> : null}
    </div>
  );
}
