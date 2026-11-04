import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/layout/page-header";
import { AssuranceRecord } from "@/components/modules/assurance/record";
import { getSessionContext } from "@/lib/auth";
import { assuranceAction } from "@/lib/actions/assurance";
import { ASSURANCE_VIEWS, assuranceDetailSchema, canReadAssurance, type AssuranceView } from "@/lib/workflow/assurance";

export default async function AssuranceDetailPage({ params, searchParams }: { params: Promise<{ view: string; id: string }>; searchParams: Promise<{ page?: string }> }) {
  const context = await getSessionContext(); const route = await params; const query = await searchParams;
  if (!Object.hasOwn(ASSURANCE_VIEWS, route.view) || !z.string().uuid().safeParse(route.id).success) redirect("/tasks/assurance");
  const view = route.view as AssuranceView;
  if (!canReadAssurance(context.role, view)) redirect("/tasks/assurance");
  const page = Math.min(Math.max(Number.parseInt(query.page ?? "1", 10) || 1, 1), 100000);
  const result = await assuranceAction({ command: "detail", view, id: route.id, page });
  const parsed = result.success ? assuranceDetailSchema.safeParse(result.data) : null;
  const data = parsed?.success ? parsed.data : null; const pages = Math.max(1, Math.ceil((data?.event_count ?? 0) / 10));
  const historyHref = (next: number) => `/tasks/assurance/${view}/${route.id}?page=${next}`;
  return <div className="mx-auto max-w-4xl space-y-5"><PageHeader density="compact" title={ASSURANCE_VIEWS[view]} description="Current source position, the rule applied and retained change history." actions={<Link href={`/tasks/assurance/database?view=${view}`} className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">View database</Link>} />
    {!data ? <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm font-semibold text-amber-950">{!result.success ? result.error : "The record could not be read. Reload to retry."}</p> : <>
      <AssuranceRecord key={`${view}:${route.id}:${data.as_of}`} view={view} detail={data} context={context} />
      <section className="space-y-3 rounded-2xl border bg-white p-4"><h2 className="font-bold">Recorded assurance history</h2>{data.events.length ? <ol className="space-y-4">{data.events.map(event => <li key={event.id} className="space-y-1 border-l-2 border-slate-200 pl-3"><p className="text-sm font-bold">{event.action.replaceAll(".", " ")} · {event.actor}</p><p className="break-words text-sm text-slate-700">{event.note}</p><p className="text-xs text-slate-500">{new Date(event.recorded_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST</p></li>)}</ol> : <p className="text-sm text-slate-600">No assurance actions recorded on this page. Operational history remains in the source workflow.</p>}
        {pages > 1 ? <nav aria-label="History pages" className="flex flex-wrap justify-between gap-3 text-sm font-bold">{page > 1 ? <Link href={historyHref(page - 1)}>Previous history</Link> : <span />}<span>{page} of {pages}</span>{page < pages ? <Link href={historyHref(page + 1)}>Next history</Link> : <span />}</nav> : null}
      </section>
    </>}
  </div>;
}
