import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { ImprovementProposal, ImprovementReview, OutcomeCard } from "@/components/modules/tasks/procedure-effectiveness";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { flagsSchema, improvementsSchema, improvementSchema, outcomesSchema } from "@/lib/workflow/procedure-effectiveness";

export default async function EffectivenessPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string }> }) {
  const [{ id }, query, context] = await Promise.all([params, searchParams, getSessionContext()]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  if (context.dealerId || !can(context.role, "read", "tasks")) redirect("/tasks");
  const page = Math.min(Math.max(Number.parseInt(query.page ?? "1", 10) || 1, 1), 100000);
  const client = await createClient();
  const rpc = (command: string, payload: object) => client.rpc("procedure_effectiveness_command", { p_command: command, p_payload: payload });
  const [out, fl, im] = await Promise.all([rpc("outcomes", { procedure_id: id }), rpc("flags.list", { procedure_id: id, page }), rpc("improvements.list", { procedure_id: id, page })]);
  const summary = !out.error ? outcomesSchema.safeParse(out.data) : null;
  const flags = !fl.error ? flagsSchema.safeParse(fl.data).data : null;
  const improvements = !im.error ? improvementsSchema.safeParse(im.data).data : null;
  const full = await Promise.all((improvements?.rows ?? []).map(async i => {
    if (i.status !== "measured") return i;
    const r = await rpc("improvement.load", { improvement_id: i.id });
    return !r.error ? improvementSchema.safeParse(r.data).data ?? i : i;
  }));
  return <div className="space-y-5"><PageHeader title={summary?.success ? `${summary.data.procedure.title}: effectiveness` : "SOP effectiveness"} description="Review recorded outcomes, recurring step problems, controlled trials and the reviewed revisions they produced." actions={<Link className="text-sm font-bold underline" href={`/tasks/procedures/${id}/versions`}>Procedure versions</Link>} />{summary?.success ? <><section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{summary.data.versions.map(o => <OutcomeCard key={o.version_id} outcome={o} />)}</section><p className="text-sm text-slate-600">Durations use recorded starts and completions. Samples under five are flagged. Different work mixes and waiting time can affect outcomes.</p><section className="rounded-3xl border border-slate-200 bg-white p-5"><h2 className="mb-3 font-bold">Propose a change</h2>{context.role !== "viewer" ? <ImprovementProposal procedureId={id} flags={flags?.rows ?? []} /> : <p className="text-sm">View-only access.</p>}</section><section className="space-y-3"><h2 className="font-bold">Improvements</h2>{full.length ? full.map(i => <ImprovementReview key={`${i.id}:${i.updated_at}`} improvement={i} canReview={summary.data.can_review} releases={summary.data.versions.map(v => ({ id: v.version_id, version_no: v.version_no }))} />) : <p className="text-sm text-slate-500">No improvements on this page.</p>}</section>{!flags || !improvements ? <p role="alert">Some review records could not be loaded. Refresh to retry.</p> : null}{Math.max(flags?.total_count ?? 0, improvements?.total_count ?? 0) > 10 ? <nav className="flex justify-between text-sm">{page > 1 ? <Link href={`?page=${page - 1}`}>Previous</Link> : <span />}<span>Page {page}</span>{page * 10 < Math.max(flags?.total_count ?? 0, improvements?.total_count ?? 0) ? <Link href={`?page=${page + 1}`}>Next</Link> : <span />}</nav> : null}</> : <p role="alert" className="rounded-2xl bg-amber-50 p-4">SOP effectiveness could not be loaded. Contact your administrator if refreshing does not resolve it.</p>}</div>;
}
