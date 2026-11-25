import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { ListControls, SortHeader } from "@/components/modules/orchestration/list-controls";
import { getSessionContext } from "@/lib/auth";
import { hasRouteAccess } from "@/lib/auth/route-permissions";
import { complaintAction } from "@/lib/actions/orchestration";
import { floorText } from "@/lib/i18n/floor";
import {
  COMPLAINT_CATEGORIES, COMPLAINT_CATEGORY_LABELS, COMPLAINT_SORTS, COMPLAINT_STATUS_LABELS, COMPLAINT_VIEWS, SEVERITIES, complaintListSchema, complaintSort, pick
} from "@/lib/workflow/delivery-closure";

const day = (value: string | null) => (value ? new Date(value).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }) : "—");
const VIEW_LABELS: Record<(typeof COMPLAINT_VIEWS)[number], string> = { all: "All", open: "Open (any step)", overdue: "Overdue", open_complaints: "Logged", investigating: "Investigating",
  action: "Resolution due", resolved: "Verification due", closed: "Closed", rejected: "Rejected", withdrawn: "Withdrawn" };
const SORT_LABELS: Record<(typeof COMPLAINT_SORTS)[number], string> = { logged_at: "Logged", due_at: "Due", severity: "Severity", complaint_number: "Number" };

// Phase 7: every complaint — search, status, category and severity filters, sorting, 10 per page in the database.
export default async function ComplaintDatabasePage({ searchParams }: { searchParams: Promise<{ view?: string; category?: string; severity?: string; page?: string; q?: string; sort?: string; dir?: string }> }) {
  const [q, context] = await Promise.all([searchParams, getSessionContext()]);
  if (context.dealerId || !hasRouteAccess("/quality/complaints", context.role)) redirect("/dashboard");
  const t = floorText("en");
  const view = pick(COMPLAINT_VIEWS, q.view, "all");
  const category = (COMPLAINT_CATEGORIES as readonly string[]).includes(q.category ?? "") ? q.category as (typeof COMPLAINT_CATEGORIES)[number] : undefined;
  const severity = (SEVERITIES as readonly string[]).includes(q.severity ?? "") ? q.severity as (typeof SEVERITIES)[number] : undefined;
  const page = Math.min(Math.max(Number.parseInt(q.page ?? "1", 10) || 1, 1), 100000);
  const search = (q.q ?? "").trim().slice(0, 80);
  const sort = complaintSort(q.sort);
  const direction = q.dir === "asc" || q.dir === "desc" ? q.dir : sort === "complaint_number" || sort === "due_at" ? "asc" : "desc";
  const result = await complaintAction({ command: "list", view, page, sort, direction, ...(category ? { category } : {}), ...(severity ? { severity } : {}), ...(search ? { search } : {}) });
  const list = result.success ? complaintListSchema.safeParse(result.data).data ?? null : null;
  const href = (next: { page?: number; sort?: string; dir?: string }) => {
    const p = new URLSearchParams({ view });
    if (category) p.set("category", category);
    if (severity) p.set("severity", severity);
    if (search) p.set("q", search);
    p.set("sort", next.sort ?? sort); p.set("dir", next.dir ?? direction);
    if (next.page && next.page > 1) p.set("page", String(next.page));
    return `?${p.toString()}`;
  };
  return (
    <div className="space-y-5">
      <PageHeader title="Complaint database" backHref="/quality/complaints" backLabel="Back to complaints" description="All customer complaints with their step, severity and due date."
        actions={list?.can_log ? <Link href="/quality/complaints/new" className="rounded-xl bg-charcoal px-4 py-3 text-sm font-bold text-white">Log a complaint</Link> : null} />
      <form method="get" className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm font-semibold">Step<select name="view" defaultValue={view} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">
          {COMPLAINT_VIEWS.map(v => <option key={v} value={v}>{VIEW_LABELS[v]}</option>)}</select></label>
        <label className="text-sm font-semibold">Category<select name="category" defaultValue={category ?? ""} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">
          <option value="">All categories</option>{COMPLAINT_CATEGORIES.map(c => <option key={c} value={c}>{COMPLAINT_CATEGORY_LABELS[c]}</option>)}</select></label>
        <label className="text-sm font-semibold">Severity<select name="severity" defaultValue={severity ?? ""} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">
          <option value="">All severities</option>{SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}</select></label>
        <input type="hidden" name="q" value={search} /><input type="hidden" name="sort" value={sort} /><input type="hidden" name="dir" value={direction} />
        <div className="flex items-end"><button type="submit" className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-bold">Filter</button></div>
      </form>
      <ListControls t={t} search={search} searchHint="Number, defect, customer, order, dispatch or reference" hidden={{ view, ...(category ? { category } : {}), ...(severity ? { severity } : {}) }}
        sort={sort} direction={direction} clearHref="?view=all" sorts={COMPLAINT_SORTS.map(s => ({ value: s, label: SORT_LABELS[s] }))} />
      {!list ? <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{!result.success ? result.error : "The complaints could not be read."}</p>
        : list.rows.length === 0 ? <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">No complaint matches.</p> : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50"><tr>
              <SortHeader t={t} label="Complaint" field="complaint_number" sort={sort} direction={direction} href={(s, d) => href({ sort: s, dir: d })} />
              <th scope="col" className="px-3 py-2 font-bold">Customer · order</th>
              <th scope="col" className="px-3 py-2 font-bold">Defect</th>
              <SortHeader t={t} label="Severity" field="severity" sort={sort} direction={direction} href={(s, d) => href({ sort: s, dir: d })} />
              <th scope="col" className="px-3 py-2 font-bold">Step</th>
              <SortHeader t={t} label="Due" field="due_at" sort={sort} direction={direction} href={(s, d) => href({ sort: s, dir: d })} />
              <SortHeader t={t} label="Logged" field="logged_at" sort={sort} direction={direction} href={(s, d) => href({ sort: s, dir: d })} />
            </tr></thead>
            <tbody>{list.rows.map(c => (
              <tr key={c.id} className="border-t align-top">
                <td className="px-3 py-2 font-semibold"><Link className="underline" href={`/quality/complaints/${c.id}`}>{c.complaint_number}</Link><div className="text-xs">{COMPLAINT_CATEGORY_LABELS[c.category]}</div></td>
                <td className="px-3 py-2">{c.customer ?? "—"}<div className="text-xs">{c.order_number ?? "—"}</div></td>
                <td className="max-w-xs px-3 py-2 [overflow-wrap:anywhere]">{c.description}</td>
                <td className={`px-3 py-2 ${c.severity === "critical" || c.severity === "high" ? "font-bold text-red-900" : ""}`}>{c.severity}</td>
                <td className="px-3 py-2">{c.status ? COMPLAINT_STATUS_LABELS[c.status] : "—"}</td>
                <td className={`px-3 py-2 ${c.overdue ? "font-bold text-red-900" : ""}`}>{day(c.due_at)}</td>
                <td className="px-3 py-2">{day(c.logged_at)}</td>
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
