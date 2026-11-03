import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { getSessionContext } from "@/lib/auth";
import { assuranceAction } from "@/lib/actions/assurance";
import { ASSURANCE_DESCRIPTIONS, ASSURANCE_VIEWS, assuranceListSchema, assuranceStatusLabel, canReadAssurance, type AssuranceView } from "@/lib/workflow/assurance";

export default async function AssurancePage() {
  const context = await getSessionContext();
  const views = (Object.keys(ASSURANCE_VIEWS) as AssuranceView[]).filter(view => canReadAssurance(context.role, view));
  const summaries = await Promise.all(views.map(async view => {
    const result = await assuranceAction({ command: "list", view, sort: "priority" });
    const parsed = result.success ? assuranceListSchema.safeParse(result.data) : null;
    return { view, data: parsed?.success ? parsed.data : null, error: !result.success ? result.error : "This source could not be read." };
  }));
  return <div className="space-y-5"><PageHeader title="Assurance" description="Approved drawings, accepted material, delivered quantities, qualified people and traceable evidence from current records." actions={<Link href="/tasks" className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">All tasks</Link>} />
    <div className="grid gap-4 lg:grid-cols-2">{summaries.map(({ view, data, error }) => <section key={view} className="min-w-0 space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="text-lg font-bold">{ASSURANCE_VIEWS[view]}</h2><p className="text-sm text-slate-600">{ASSURANCE_DESCRIPTIONS[view]}</p>
      {!data ? <p role="alert" className="text-sm font-semibold text-amber-900">{error}</p> : <><p className="text-sm font-semibold">{data.total_count} record(s) needing attention</p>
        {data.rows.length ? <ul className="space-y-2">{data.rows.slice(0, 3).map(row => <li key={row.id} className="min-w-0 text-sm"><div className="flex flex-wrap items-center gap-2"><Link className="break-words font-semibold underline" href={`/tasks/assurance/${view}/${row.id}`}>{row.label}</Link><Badge value={row.status} /></div><p className="break-words text-xs text-slate-600">{assuranceStatusLabel(row.status)} · {row.summary}</p></li>)}</ul>
          : <p className="text-sm text-slate-600">Nothing needs attention here now. Open the database to include history.</p>}</>}
      <Link href={`/tasks/assurance/database?view=${view}`} className="inline-flex min-h-11 items-center text-sm font-bold underline">View {ASSURANCE_VIEWS[view].toLowerCase()} database</Link>
    </section>)}</div>
  </div>;
}
