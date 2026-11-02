import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { getSessionContext } from "@/lib/auth";
import { coordinationAction } from "@/lib/actions/coordination";
import { COORDINATION_VIEWS, COLLECTION_BUCKETS, canReadCoordination, canUseCoordinationAction, coordinationListSchema, type CoordinationAction, type CoordinationView } from "@/lib/workflow/coordination";
import { formatDate } from "@/lib/utils/format";

const creates: Partial<Record<CoordinationView, CoordinationAction>> = { collections: "collection.create", handoffs: "contract.publish", coverage: "coverage.propose", sessions: "session.start", requests: "request.create", stewards: "steward.assign", corrections: "correction.report" };

export default async function CoordinationDatabase({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const context = await getSessionContext(); const params = await searchParams;
  const view: CoordinationView = Object.hasOwn(COORDINATION_VIEWS, params.view ?? "") ? params.view as CoordinationView : "orders";
  if (!canReadCoordination(context.role, view)) redirect("/tasks/coordination");
  const page = Math.min(Math.max(Number.parseInt(params.page ?? "1", 10) || 1, 1), 100000);
  const state = params.state === "all" ? "all" : "active"; const search = (params.search ?? "").trim().slice(0, 80);
  const bucket = view === "collections" && Object.hasOwn(COLLECTION_BUCKETS, params.bucket ?? "") ? params.bucket as keyof typeof COLLECTION_BUCKETS : "all";
  const sort = ["priority", "due", "newest"].includes(params.sort ?? "") ? params.sort as "priority" | "due" | "newest" : view === "sessions" ? "newest" : "priority";
  const result = await coordinationAction({ command: "list", view, page, state, search, sort, bucket });
  const parsed = result.success ? coordinationListSchema.safeParse(result.data) : null;
  const data = parsed?.success ? parsed.data : null;
  const totalPages = Math.max(1, Math.ceil((data?.total_count ?? 0) / 10));
  const href = (next: number) => `/tasks/coordination/database?${new URLSearchParams({ view, page: String(next), state, search, sort, bucket })}`;
  const create = creates[view];
  return <div className="space-y-5"><PageHeader title={COORDINATION_VIEWS[view]} description="Ten records per page, filtered and sorted on the server." actions={<div className="flex flex-wrap gap-2"><Link href="/tasks/coordination" className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">Coordination overview</Link>{create && canUseCoordinationAction(context.role, create) ? <Link href={`/tasks/coordination/new?action=${create}`} className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-bold text-white">Create or assign</Link> : null}</div>} />
    <nav aria-label="Coordination databases" className="flex flex-wrap gap-2">{(Object.keys(COORDINATION_VIEWS) as CoordinationView[]).filter(key => canReadCoordination(context.role, key)).map(key => <Link key={key} href={`/tasks/coordination/database?view=${key}`} aria-current={view === key ? "page" : undefined} className={`rounded-xl border px-3 py-2 text-sm font-semibold ${view === key ? "bg-slate-950 text-white" : "bg-white text-slate-700"}`}>{COORDINATION_VIEWS[key]}</Link>)}</nav>
    <form method="get" className="grid gap-3 rounded-2xl border bg-white p-4 sm:grid-cols-[1fr_180px_180px_auto] sm:items-end"><input type="hidden" name="view" value={view} />
      <label className="space-y-1"><span className="form-label">Search records</span><input className="form-input" name="search" maxLength={80} defaultValue={search} /></label>
      <label className="space-y-1"><span className="form-label">Scope</span><select className="form-input" name="state" defaultValue={state}><option value="active">Current records</option><option value="all">Include history</option></select></label>
      <label className="space-y-1"><span className="form-label">Sort</span><select className="form-input" name="sort" defaultValue={sort}><option value="priority">Priority then due</option><option value="due">Due date</option><option value="newest">Newest first</option></select></label>
      <button type="submit" className="min-h-11 rounded-xl bg-slate-950 px-4 py-2 font-bold text-white">Apply filters</button>
      {view === "collections" ? <label className="space-y-1 sm:col-span-2"><span className="form-label">Collection queue</span><select className="form-input" name="bucket" defaultValue={bucket}>{Object.entries(COLLECTION_BUCKETS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label> : null}
    </form>
    {search || state === "all" ? <p className="text-sm text-slate-700">Active filters: {search ? `search "${search}"; ` : ""}{state === "all" ? "including history" : "current records"}. <Link href={`/tasks/coordination/database?view=${view}`} className="font-bold underline">Clear filters</Link></p> : null}
    {!data ? <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm font-semibold text-amber-950">{!result.success ? result.error : "This source could not be read. Reload to retry."}</p> : <>
      {!data.rows.length ? <div className="rounded-2xl border bg-white p-6"><h2 className="font-bold">{search ? "No records match these filters" : "No records in this scope"}</h2><p className="mt-2 text-sm text-slate-600">{page > totalPages ? "This page is beyond the current results. Return to page one." : "Change the scope to include history, clear the filters, or create a supported record using the action above."}</p><Link className="mt-3 inline-flex min-h-11 items-center font-semibold underline" href={href(1)}>Return to first page</Link></div> : <ul className="divide-y rounded-2xl border border-slate-200 bg-white">{data.rows.map(row => <li key={row.id} className="min-w-0 p-4"><Link href={`/tasks/coordination/${view}/${row.id}`} className="block space-y-2 rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-800"><div className="flex flex-wrap items-start justify-between gap-2"><span className="break-words font-bold">{row.label}</span><Badge value={row.status} /></div><p className="break-words text-sm text-slate-600">{row.summary}</p><p className="text-xs font-semibold text-slate-500">{row.owner ?? "Unassigned"}{row.due_date ? ` · Due ${formatDate(row.due_date)}` : ""}</p></Link></li>)}</ul>}
      <nav aria-label="Database pages" className="flex flex-wrap items-center justify-between gap-3 text-sm font-bold">{page > 1 ? <Link className="rounded-xl border bg-white px-4 py-3" href={href(page - 1)}>Previous</Link> : <span />}<span>Page {page} of {totalPages} · {data.total_count} records</span>{page < totalPages ? <Link className="rounded-xl border bg-white px-4 py-3" href={href(page + 1)}>Next</Link> : <span />}</nav>
      <p className="text-xs text-slate-500">Read as of {new Date(data.as_of).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST. Promises, tasks, readiness and permissions remain distinct.</p>
    </>}
    {view === "coverage" && canUseCoordinationAction(context.role, "coverage.reconcile") ? <Link className="inline-flex min-h-11 items-center text-sm font-bold underline" href="/tasks/coordination/new?action=coverage.reconcile">Review coverage synchronization</Link> : null}
    {view === "collections" ? <Link className="inline-flex min-h-11 items-center text-sm font-bold underline" href="/payments/receipts">Review receipts and their current allocation</Link> : null}
  </div>;
}
