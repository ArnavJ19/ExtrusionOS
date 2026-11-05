import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/layout/page-header";
import { CommercialRecord } from "@/components/modules/commercial/record";
import { getSessionContext } from "@/lib/auth";
import { commercialAction } from "@/lib/actions/commercial";
import { COMMERCIAL_VIEWS, canReadCommercial, commercialDetailSchema, type CommercialView } from "@/lib/workflow/commercial";

export default async function CommercialDetailPage({ params, searchParams }: { params: Promise<{ view: string; id: string }>; searchParams: Promise<{ page?: string }> }) {
  const context = await getSessionContext(); const route = await params; const query = await searchParams;
  if (!Object.hasOwn(COMMERCIAL_VIEWS, route.view) || !z.string().uuid().safeParse(route.id).success) redirect("/tasks/commercial");
  const view = route.view as CommercialView;
  if (!canReadCommercial(context.role, view)) redirect("/tasks/commercial");
  const page = Math.min(Math.max(Number.parseInt(query.page ?? "1", 10) || 1, 1), 100000);
  const result = await commercialAction({ command: "detail", view, id: route.id, page });
  const parsed = result.success ? commercialDetailSchema.safeParse(result.data) : null;
  const data = parsed?.success ? parsed.data : null; const pages = Math.max(1, Math.ceil((data?.event_count ?? 0) / 10));
  const historyHref = (next: number) => `/tasks/commercial/${view}/${route.id}?page=${next}`;
  return <div className="mx-auto max-w-4xl space-y-5"><PageHeader density="compact" title={COMMERCIAL_VIEWS[view]} description="Current source position, the rule applied and retained change history." actions={<Link href={`/tasks/commercial/database?view=${view}`} className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">View database</Link>} />
    {!data ? <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm font-semibold text-amber-950">{!result.success ? result.error : "The record could not be read. Reload to retry."}</p> : <>
      <CommercialRecord key={`${view}:${route.id}:${data.as_of}`} view={view} detail={data} context={context} />
      <section className="space-y-3 rounded-2xl border bg-white p-4"><h2 className="font-bold">Recorded history</h2>{data.events.length ? <ol className="space-y-4">{data.events.map(event => <li key={event.id} className="space-y-1 border-l-2 border-slate-200 pl-3"><p className="text-sm font-bold">{event.action.replaceAll(".", " ")} · {event.actor}</p><p className="break-words text-sm text-slate-700">{event.note}</p><p className="text-xs text-slate-500">{new Date(event.recorded_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST</p></li>)}</ol> : <p className="text-sm text-slate-600">No actions recorded on this page. Operational history remains in the source workflow.</p>}
        {pages > 1 ? <nav aria-label="History pages" className="flex flex-wrap justify-between gap-3 text-sm font-bold">{page > 1 ? <Link href={historyHref(page - 1)}>Previous history</Link> : <span />}<span>{page} of {pages}</span>{page < pages ? <Link href={historyHref(page + 1)}>Next history</Link> : <span />}</nav> : null}
      </section>
    </>}
  </div>;
}
