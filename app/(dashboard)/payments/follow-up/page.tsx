import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { ListControls, SortHeader } from "@/components/modules/orchestration/list-controls";
import { getSessionContext } from "@/lib/auth";
import { hasRouteAccess } from "@/lib/auth/route-permissions";
import { receivableFollowupAction } from "@/lib/actions/orchestration";
import { floorText } from "@/lib/i18n/floor";
import { formatCurrency } from "@/lib/utils/format";
import { RECEIVABLE_SORTS, RECEIVABLE_VIEWS, pick, receivableListSchema, receivableSort } from "@/lib/workflow/delivery-closure";

const VIEW_LABELS: Record<(typeof RECEIVABLE_VIEWS)[number], string> = { due: "Due for follow-up", overdue: "Overdue", disputed: "Disputed", write_off_pending: "Write-off awaiting decision", all_open: "All open" };
const SORT_LABELS: Record<(typeof RECEIVABLE_SORTS)[number], string> = { due_date: "Due date", collectible: "Collectible", invoice_number: "Invoice", days_overdue: "Days overdue" };

// Phase 7 (finance only): invoices due and unsettled under the agreed terms, with what is collectible after write-offs
// approved under authority, disputed amounts and pending write-offs. A shipment marked delivered never settles one.
export default async function PaymentFollowUpPage({ searchParams }: { searchParams: Promise<{ view?: string; page?: string; q?: string; sort?: string; dir?: string }> }) {
  const [q, context] = await Promise.all([searchParams, getSessionContext()]);
  if (context.dealerId || !hasRouteAccess("/payments/follow-up", context.role)) redirect("/dashboard");
  const t = floorText("en");
  const view = pick(RECEIVABLE_VIEWS, q.view, "due");
  const page = Math.min(Math.max(Number.parseInt(q.page ?? "1", 10) || 1, 1), 100000);
  const search = (q.q ?? "").trim().slice(0, 80);
  const sort = receivableSort(q.sort);
  const direction = q.dir === "asc" || q.dir === "desc" ? q.dir : sort === "due_date" || sort === "invoice_number" ? "asc" : "desc";
  const result = await receivableFollowupAction({ command: "list", view, page, sort, direction, ...(search ? { search } : {}) });
  const list = result.success ? receivableListSchema.safeParse(result.data).data ?? null : null;
  const href = (next: { view?: string; page?: number; sort?: string; dir?: string }) => {
    const p = new URLSearchParams({ view: next.view ?? view });
    if (search) p.set("q", search);
    p.set("sort", next.sort ?? sort); p.set("dir", next.dir ?? direction);
    if (next.page && next.page > 1) p.set("page", String(next.page));
    return `?${p.toString()}`;
  };
  return (
    <div className="space-y-5">
      <PageHeader title="Payment follow-up" backHref="/payments" backLabel="Back to payments"
        description={`Invoices due${list?.lead_days ? ` within ${list.lead_days} day(s)` : ""} or overdue and not settled. Record payments on the payments screen; record disputes and write-offs here. A write-off needs an authorised approver, never the proposer.`}
        actions={<Link href="/payments/reminders" className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">Customer reminders</Link>} />
      <nav className="flex flex-wrap gap-2" aria-label="Receivable views">
        {RECEIVABLE_VIEWS.map(v => <Link key={v} href={href({ view: v })} aria-current={view === v ? "page" : undefined}
          className={`inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-bold ${view === v ? "bg-charcoal text-white" : "border border-slate-300 bg-white"}`}>{VIEW_LABELS[v]}</Link>)}
      </nav>
      <ListControls t={t} search={search} searchHint="Invoice, order, dispatch or customer" hidden={{ view }} sort={sort} direction={direction} clearHref={`?view=${view}`}
        sorts={RECEIVABLE_SORTS.map(s => ({ value: s, label: SORT_LABELS[s] }))} />
      {!list ? <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{!result.success ? result.error : "The receivables could not be read."}</p>
        : list.rows.length === 0 ? <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">Nothing to follow up in this view.</p> : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50"><tr>
              <SortHeader t={t} label="Invoice" field="invoice_number" sort={sort} direction={direction} href={(s, d) => href({ sort: s, dir: d })} />
              <th scope="col" className="px-3 py-2 font-bold">Customer · order</th>
              <SortHeader t={t} label="Due" field="due_date" sort={sort} direction={direction} href={(s, d) => href({ sort: s, dir: d })} />
              <SortHeader t={t} label="Overdue" field="days_overdue" sort={sort} direction={direction} href={(s, d) => href({ sort: s, dir: d })} />
              <SortHeader t={t} label="Collectible" field="collectible" sort={sort} direction={direction} href={(s, d) => href({ sort: s, dir: d })} />
              <th scope="col" className="px-3 py-2 font-bold">Disputed · write-off</th>
              <th scope="col" className="px-3 py-2 font-bold">Delivery</th>
            </tr></thead>
            <tbody>{list.rows.map(r => (
              <tr key={r.invoice_id} className="border-t align-top">
                <td className="px-3 py-2 font-semibold"><Link className="underline" href={`/payments/follow-up/${r.invoice_id}`}>{r.invoice_number ?? "Invoice"}</Link></td>
                <td className="px-3 py-2">{r.customer ?? "—"}<div className="text-xs">{r.order_number ?? "—"}</div></td>
                <td className="px-3 py-2">{r.due_date ?? r.invoice_date}</td>
                <td className={`px-3 py-2 ${r.days_overdue > 30 ? "font-bold text-red-900" : ""}`}>{r.days_overdue ? `${r.days_overdue} day(s)` : "—"}</td>
                <td className="px-3 py-2 font-semibold">{formatCurrency(r.collectible)}{r.balance !== r.collectible ? <div className="text-xs font-normal">balance {formatCurrency(r.balance)}</div> : null}</td>
                <td className="px-3 py-2">{r.disputed ? formatCurrency(r.disputed) : "—"} · {r.pending_write_off ? `${formatCurrency(r.pending_write_off)} pending` : r.written_off ? `${formatCurrency(r.written_off)} written off` : "—"}</td>
                <td className="px-3 py-2">{r.dispatch_number ? `${r.dispatch_number} · ${(r.delivery_status ?? "").replace(/_/g, " ")}` : "Not linked to a dispatch"}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
      {list && list.total > list.page_size ? <nav className="flex justify-between text-sm font-semibold" aria-label="Pages">
        {page > 1 ? <Link href={href({ page: page - 1 })}>Previous</Link> : <span />}<span>Page {page} of {Math.ceil(list.total / list.page_size)}</span>
        {page * list.page_size < list.total ? <Link href={href({ page: page + 1 })}>Next</Link> : <span />}</nav> : null}
    </div>
  );
}
