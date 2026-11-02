import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { getSessionContext } from "@/lib/auth";
import { coordinationAction } from "@/lib/actions/coordination";
import { COORDINATION_VIEWS, canReadCoordination, coordinationListSchema, type CoordinationView } from "@/lib/workflow/coordination";

const descriptions: Record<CoordinationView, string> = {
  orders: "Accountable coordinators, pending transfers and the shared operational priority.", collections: "Payment promises beside current invoice balances. Promises do not post receipts.",
  handoffs: "Versioned receiving expectations and the handoffs created under each revision.", coverage: "Acknowledged backup responsibility and existing time-bounded task delegation.",
  sessions: "Retained daily agendas with current source links and unresolved decisions.", decisions: "Assigned actions carried forward through their original tasks.",
  requests: "Requests involving you, with needed-by dates and explicit completion criteria.", stewards: "Primary and backup responsibility for profile section-weight corrections.",
  corrections: "Evidence-backed corrections, current-master review and preserved historical snapshots."
};

export default async function CoordinationPage() {
  const context = await getSessionContext();
  const views = (Object.keys(COORDINATION_VIEWS) as CoordinationView[]).filter(view => canReadCoordination(context.role, view));
  const summaries = await Promise.all(views.map(async view => {
    const result = await coordinationAction({ command: "list", view, sort: view === "sessions" ? "newest" : "priority" });
    const parsed = result.success ? coordinationListSchema.safeParse(result.data) : null;
    return { view, data: parsed?.success ? parsed.data : null, error: !result.success ? result.error : "This source could not be read." };
  }));
  return <div className="space-y-5"><PageHeader title="Daily coordination" description="Follow responsibility, commitments and cross-team decisions from current records." actions={<Link href="/tasks" className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">All tasks</Link>} />
    <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">Priority policy: urgent, high, normal, low; then dispatch due date and stable record identity. Readiness and capacity decisions stay in their source workflows.</p>
    <div className="grid gap-4 lg:grid-cols-2">{summaries.map(({ view, data, error }) => <section key={view} className="min-w-0 space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="text-lg font-bold">{COORDINATION_VIEWS[view]}</h2><p className="text-sm text-slate-600">{descriptions[view]}</p>
      {!data ? <p role="alert" className="text-sm font-semibold text-amber-900">{error}</p> : <><p className="text-sm font-semibold">{data.total_count} {view === "sessions" ? "recorded" : "current"} record(s)</p>{data.rows.length ? <ul className="space-y-2">{data.rows.slice(0, 3).map(row => <li key={row.id} className="text-sm"><Link className="font-semibold underline" href={`/tasks/coordination/${view}/${row.id}`}>{row.label}</Link><p className="text-xs text-slate-600">{row.owner ?? "Unassigned"} · {row.status.replaceAll("_", " ")}</p></li>)}</ul> : <p className="text-sm text-slate-600">No records in this scope. Open the database to see history or create the first supported record.</p>}</>}
      <Link href={`/tasks/coordination/database?view=${view}`} className="inline-flex min-h-11 items-center text-sm font-bold underline">View {COORDINATION_VIEWS[view].toLowerCase()} database</Link>
    </section>)}</div>
  </div>;
}
