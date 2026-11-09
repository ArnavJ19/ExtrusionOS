import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { getSessionContext } from "@/lib/auth";
import { commercialAction } from "@/lib/actions/commercial";
import { COMMERCIAL_DESCRIPTIONS, COMMERCIAL_VIEWS, canReadCommercial, commercialListSchema, commercialStatusLabel, type CommercialView } from "@/lib/workflow/commercial";

export default async function CommercialPage() {
  const context = await getSessionContext();
  const views = (Object.keys(COMMERCIAL_VIEWS) as CommercialView[]).filter(view => canReadCommercial(context.role, view));
  const summaries = await Promise.all(views.map(async view => {
    const result = await commercialAction({ command: "list", view, sort: "priority" });
    const parsed = result.success ? commercialListSchema.safeParse(result.data) : null;
    return { view, data: parsed?.success ? parsed.data : null, error: !result.success ? result.error : "This source could not be read." };
  }));
  return <div className="space-y-5"><PageHeader title="Commercial and planning" description="Quantity pricing, supplier claims, job profitability, supplier reliability, quotation outcomes, remnants, accounting export, compatible runs and what-if scenarios from current records." actions={<Link href="/tasks" className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">All tasks</Link>} />
    <div className="grid gap-4 lg:grid-cols-2">{summaries.map(({ view, data, error }) => <section key={view} className="min-w-0 space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="text-lg font-bold">{COMMERCIAL_VIEWS[view]}</h2><p className="text-sm text-slate-600">{COMMERCIAL_DESCRIPTIONS[view]}</p>
      {!data ? <p role="alert" className="text-sm font-semibold text-amber-900">{error}</p> : <><p className="text-sm font-semibold">{data.total_count} record(s) needing attention</p>
        {data.rows.length ? <ul className="space-y-2">{data.rows.slice(0, 3).map(row => <li key={row.id} className="min-w-0 text-sm"><div className="flex flex-wrap items-center gap-2"><Link className="break-words font-semibold underline" href={`/tasks/commercial/${view}/${row.id}`}>{row.label}</Link><Badge value={row.status} /></div><p className="break-words text-xs text-slate-600">{commercialStatusLabel(row.status, view)} · {row.summary}</p></li>)}</ul>
          : <p className="text-sm text-slate-600">Nothing needs attention here now. Open the database to include history.</p>}</>}
      <Link href={`/tasks/commercial/database?view=${view}`} className="inline-flex min-h-11 items-center text-sm font-bold underline">View {COMMERCIAL_VIEWS[view].toLowerCase()} database</Link>
    </section>)}</div>
  </div>;
}
