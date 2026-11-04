import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { getSessionContext } from "@/lib/auth";
import { improvementAction } from "@/lib/actions/improvement";
import { IMPROVEMENT_DESCRIPTIONS, IMPROVEMENT_VIEWS, improvementListSchema, improvementStatusLabel, canReadImprovement, type ImprovementView } from "@/lib/workflow/improvement";

export default async function ImprovementPage() {
  const context = await getSessionContext();
  const views = (Object.keys(IMPROVEMENT_VIEWS) as ImprovementView[]).filter(view => canReadImprovement(context.role, view));
  const summaries = await Promise.all(views.map(async view => {
    const result = await improvementAction({ command: "list", view, sort: "priority" });
    const parsed = result.success ? improvementListSchema.safeParse(result.data) : null;
    return { view, data: parsed?.success ? parsed.data : null, error: !result.success ? result.error : "This source could not be read." };
  }));
  return <div className="space-y-5"><PageHeader title="Continuous improvement" description="Recurring problems, employee suggestions, team outcomes and die operating history from current records." actions={<Link href="/tasks" className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">All tasks</Link>} />
    <div className="grid gap-4 lg:grid-cols-2">{summaries.map(({ view, data, error }) => <section key={view} className="min-w-0 space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="text-lg font-bold">{IMPROVEMENT_VIEWS[view]}</h2><p className="text-sm text-slate-600">{IMPROVEMENT_DESCRIPTIONS[view]}</p>
      {!data ? <p role="alert" className="text-sm font-semibold text-amber-900">{error}</p> : <><p className="text-sm font-semibold">{data.total_count} record(s) needing attention</p>
        {data.rows.length ? <ul className="space-y-2">{data.rows.slice(0, 3).map(row => <li key={row.id} className="min-w-0 text-sm"><div className="flex flex-wrap items-center gap-2"><Link className="break-words font-semibold underline" href={`/tasks/improvement/${view}/${row.id}`}>{row.label}</Link><Badge value={row.status} /></div><p className="break-words text-xs text-slate-600">{improvementStatusLabel(row.status)} · {row.summary}</p></li>)}</ul>
          : <p className="text-sm text-slate-600">Nothing needs attention here now. Open the database to include history.</p>}</>}
      <Link href={`/tasks/improvement/database?view=${view}`} className="inline-flex min-h-11 items-center text-sm font-bold underline">View {IMPROVEMENT_VIEWS[view].toLowerCase()} database</Link>
    </section>)}</div>
  </div>;
}
