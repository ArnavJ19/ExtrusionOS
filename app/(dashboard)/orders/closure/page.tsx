import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { SortHeader } from "@/components/modules/orchestration/list-controls";
import { getSessionContext } from "@/lib/auth";
import { hasRouteAccess } from "@/lib/auth/route-permissions";
import { orderClosureAction } from "@/lib/actions/orchestration";
import { floorText } from "@/lib/i18n/floor";
import { CLOSURE_SORTS, CLOSURE_VIEWS, CLOSURE_VIEW_LABELS, closureBoardSchema, pick } from "@/lib/workflow/delivery-closure";
import { overallLabel } from "@/lib/workflow/orchestration";

const day = (value: string | null) => (value ? new Date(value).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }) : "—");
const text = (v: string | null | undefined) => (v ? v.replace(/_/g, " ") : "—");
const TABS = ["ready", "acceptance_pending", "financially_open", "financially_settled", "in_progress", "partially_closed", "fully_closed", "all"] as const;

// Phase 7: order closure (directive section 30) — operational, financial and administrative closure kept apart. An
// order is never fully closed just because it was packed or dispatched.
export default async function OrderClosureBoardPage({ searchParams }: { searchParams: Promise<{ view?: string; page?: string; q?: string; sort?: string; dir?: string }> }) {
  const [q, context] = await Promise.all([searchParams, getSessionContext()]);
  if (context.dealerId || !hasRouteAccess("/orders/closure", context.role)) redirect("/dashboard");
  const view = pick(CLOSURE_VIEWS, q.view, "ready");
  const page = Math.min(Math.max(Number.parseInt(q.page ?? "1", 10) || 1, 1), 100000);
  const search = (q.q ?? "").trim().slice(0, 80);
  const t = floorText("en");
  const sort = pick(CLOSURE_SORTS, q.sort, "last_at");
  const direction = q.dir === "asc" || q.dir === "desc" ? q.dir : sort === "order_number" ? "asc" : "desc";
  const result = await orderClosureAction({ command: "board", view, page, sort, direction, ...(search ? { search } : {}) });
  const board = result.success ? closureBoardSchema.safeParse(result.data).data ?? null : null;
  const href = (next: { view?: string; page?: number; sort?: string; dir?: string }) => {
    const p = new URLSearchParams({ view: next.view ?? view });
    if (search) p.set("q", search);
    p.set("sort", next.sort ?? sort); p.set("dir", next.dir ?? direction);
    if (next.page && next.page > 1) p.set("page", String(next.page));
    return `?${p.toString()}`;
  };
  const count = (v: string) => v === "all" ? Object.values(board?.counts ?? {}).reduce((s, n) => s + n, 0) : board?.counts[v] ?? 0;
  return (
    <div className="space-y-5">
      <PageHeader title="Order closure" backHref="/orders/lifecycle" backLabel="Back to the command centre"
        description="Orders that have shipped, by closure state: ready for operational closure, waiting for customer acceptance, closed with finance open, settled and due for final closure, and fully closed. The closure review records each closure; final closure refuses any open obligation." />
      <nav className="flex flex-wrap gap-2" aria-label="Closure states">
        {TABS.map(v => <Link key={v} href={href({ view: v })} aria-current={view === v ? "page" : undefined}
          className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-bold ${view === v ? "bg-charcoal text-white" : "border border-slate-300 bg-white"}`}>
          {CLOSURE_VIEW_LABELS[v]}<span className="rounded-full bg-slate-100 px-2 text-xs text-slate-800">{count(v)}</span></Link>)}
      </nav>
      <form method="get" className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-end">
        <input type="hidden" name="view" value={view} /><input type="hidden" name="sort" value={sort} /><input type="hidden" name="dir" value={direction} />
        <label className="flex-1 text-sm font-semibold">Search<input type="search" name="q" maxLength={80} defaultValue={search} placeholder="Order or customer" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" /></label>
        <button type="submit" className="min-h-11 rounded-xl bg-charcoal px-4 text-sm font-bold text-white">Apply</button>
      </form>
      {!board ? <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{!result.success ? result.error : "The closure board could not be read."}</p>
        : board.rows.length === 0 ? <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">No order in this state.</p> : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50"><tr>
              <SortHeader t={t} label="Order · customer" field="order_number" sort={sort} direction={direction} href={(f, d) => href({ sort: f, dir: d })} />
              {["Closure state", "Operational", "Financial"].map(h => <th key={h} scope="col" className="px-3 py-2 font-bold">{h}</th>)}
              <SortHeader t={t} label="Open items" field="blocking" sort={sort} direction={direction} href={(f, d) => href({ sort: f, dir: d })} />
              <SortHeader t={t} label="Last activity" field="last_at" sort={sort} direction={direction} href={(f, d) => href({ sort: f, dir: d })} />
            </tr></thead>
            <tbody>{board.rows.map(r => (
              <tr key={r.order_id} className="border-t align-top">
                <td className="px-3 py-2 font-semibold"><Link className="underline" href={`/orders/closure/${r.order_id}`}>{r.order_number}</Link><div className="text-xs font-normal">{r.customer ?? "—"}</div></td>
                <td className="px-3 py-2">{r.overall ? overallLabel(r.overall) : CLOSURE_VIEW_LABELS[r.group as (typeof CLOSURE_VIEWS)[number]] ?? text(r.group)}{r.authorization ? <div className="text-xs">by authorisation</div> : null}</td>
                <td className="px-3 py-2">{text(r.operational)}</td>
                <td className="px-3 py-2">{text(r.financial)}</td>
                <td className="max-w-xs px-3 py-2 [overflow-wrap:anywhere]">{r.first_blocker ? <>{r.first_blocker.label}<div className="text-xs text-slate-600">{r.blocking} open · {text(r.first_blocker.owner)}</div></> : "—"}</td>
                <td className="px-3 py-2">{day(r.last_at)}</td>
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
