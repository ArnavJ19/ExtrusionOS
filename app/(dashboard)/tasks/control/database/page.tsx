import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { getSessionContext } from "@/lib/auth";
import { controlAction } from "@/lib/actions/operations-control";
import { CONTROL_VIEWS, canReadControl, canUseControlAction, controlListSchema, controlStatusLabel, type ControlAction, type ControlView } from "@/lib/workflow/operations-control";
import { formatDate } from "@/lib/utils/format";

const creates: Partial<Record<ControlView, ControlAction[]>> = { procurement: ["plan.generate", "policy.set", "supply.link"], authority: ["authority.publish"], contracts: ["contract.publish"] };
const ACTION_LABELS: Partial<Record<ControlAction, string>> = { "plan.generate": "Generate plan", "policy.set": "Set policy", "supply.link": "Link purchase supply", "authority.publish": "Publish limits", "contract.publish": "Publish definition of done" };

export default async function ControlDatabase({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const context = await getSessionContext(); const params = await searchParams;
  const view: ControlView = Object.hasOwn(CONTROL_VIEWS, params.view ?? "") ? params.view as ControlView : "ledger";
  if (!canReadControl(context.role, view)) redirect("/tasks/control");
  const page = Math.min(Math.max(Number.parseInt(params.page ?? "1", 10) || 1, 1), 100000);
  const state = params.state === "all" ? "all" : "active"; const search = (params.search ?? "").trim().slice(0, 80);
  const status = /^[a-z_]{1,40}$/.test(params.status ?? "") ? params.status as string : "";
  const sort = ["priority", "due", "newest"].includes(params.sort ?? "") ? params.sort as "priority" | "due" | "newest" : "priority";
  const result = await controlAction({ command: "list", view, page, state, search, sort, ...(status ? { status } : {}) });
  const parsed = result.success ? controlListSchema.safeParse(result.data) : null;
  const data = parsed?.success ? parsed.data : null;
  const totalPages = Math.max(1, Math.ceil((data?.total_count ?? 0) / 10));
  const href = (next: number) => `/tasks/control/database?${new URLSearchParams({ view, page: String(next), state, search, sort, ...(status ? { status } : {}) })}`;
  const actions = (creates[view] ?? []).filter(action => canUseControlAction(context.role, action));
  return <div className="space-y-5"><PageHeader density="compact" title={CONTROL_VIEWS[view]} description="Ten records per page, filtered and sorted on the server." actions={<div className="flex flex-wrap gap-2"><Link href="/tasks/control" className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">Controls overview</Link>
    {actions.map(action => <Link key={action} href={`/tasks/control/new?action=${action}`} className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-bold text-white">{ACTION_LABELS[action]}</Link>)}</div>} />
    <nav aria-label="Control databases" className="flex flex-wrap gap-2">{(Object.keys(CONTROL_VIEWS) as ControlView[]).filter(key => canReadControl(context.role, key)).map(key => <Link key={key} href={`/tasks/control/database?view=${key}`} aria-current={view === key ? "page" : undefined} className={`rounded-xl border px-3 py-2 text-sm font-semibold ${view === key ? "bg-slate-950 text-white" : "bg-white text-slate-700"}`}>{CONTROL_VIEWS[key]}</Link>)}</nav>
    <form method="get" className="grid gap-3 rounded-2xl border bg-white p-4 sm:grid-cols-[1fr_180px_180px_auto] sm:items-end"><input type="hidden" name="view" value={view} />
      <label className="space-y-1"><span className="form-label">Search records</span><input className="form-input" name="search" maxLength={80} defaultValue={search} /></label>
      <label className="space-y-1"><span className="form-label">Scope</span><select className="form-input" name="state" defaultValue={state}><option value="active">Needs attention</option><option value="all">Include history</option></select></label>
      <label className="space-y-1"><span className="form-label">Sort</span><select className="form-input" name="sort" defaultValue={sort}><option value="priority">Attention first</option><option value="due">Oldest or earliest date first</option><option value="newest">Newest first</option></select></label>
      <button type="submit" className="min-h-11 rounded-xl bg-slate-950 px-4 py-2 font-bold text-white">Apply filters</button>
      {status ? <input type="hidden" name="status" value={status} /> : null}
    </form>
    {search || state === "all" || status ? <p className="text-sm text-slate-700">Active filters: {search ? `search "${search}"; ` : ""}{status ? `status ${controlStatusLabel(view, status)}; ` : ""}{state === "all" ? "including history" : "needing attention"}. <Link href={`/tasks/control/database?view=${view}`} className="font-bold underline">Clear filters</Link></p> : null}
    {!data ? <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm font-semibold text-amber-950">{!result.success ? result.error : "This source could not be read. Reload to retry."}</p> : <>
      {!data.rows.length ? <div className="rounded-2xl border bg-white p-6"><h2 className="font-bold">{search || status ? "No records match these filters" : "Nothing needs attention in this scope"}</h2><p className="mt-2 text-sm text-slate-600">{page > totalPages ? "This page is beyond the current results. Return to page one." : "Include history, clear the filters, or use an action above where one is available."}</p><Link className="mt-3 inline-flex min-h-11 items-center font-semibold underline" href={href(1)}>Return to first page</Link></div>
        : <ul className="divide-y rounded-2xl border border-slate-200 bg-white">{data.rows.map(row => <li key={row.id} className="min-w-0 p-4"><Link href={`/tasks/control/${view}/${row.id}`} className="block space-y-2 rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-800"><div className="flex flex-wrap items-start justify-between gap-2"><span className="break-words font-bold">{row.label}</span><Badge value={row.status} /></div><p className="text-xs font-semibold text-slate-700">{controlStatusLabel(view, row.status)}</p><p className="break-words text-sm text-slate-600">{row.summary}</p><p className="text-xs font-semibold text-slate-500">{row.owner ?? ""}{row.owner && row.due_date ? " · " : ""}{row.due_date ? `Date ${formatDate(row.due_date)}` : ""}</p></Link></li>)}</ul>}
      <nav aria-label="Database pages" className="flex flex-wrap items-center justify-between gap-3 text-sm font-bold">{page > 1 ? <Link className="rounded-xl border bg-white px-4 py-3" href={href(page - 1)}>Previous</Link> : <span />}<span>Page {page} of {totalPages} · {data.total_count} records</span>{page < totalPages ? <Link className="rounded-xl border bg-white px-4 py-3" href={href(page + 1)}>Next</Link> : <span />}</nav>
      <p className="text-xs text-slate-500">Read as of {new Date(data.as_of).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST. Physical position, processing state and task ownership remain distinct.</p>
    </>}
  </div>;
}
