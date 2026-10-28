import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { versionSchema } from "@/lib/workflow/procedure-versions";

export default async function HistoricalProcedureVersionPage({ params }: { params: Promise<{ id: string; versionId: string }> }) {
  const [{ id, versionId }, context] = await Promise.all([params, getSessionContext()]);
  if (![id, versionId].every(v => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v))) notFound();
  if (context.dealerId || context.role.startsWith("dealer_") || !can(context.role, "read", "tasks")) redirect("/tasks");
  const client = await createClient();
  const result = await client.rpc("procedure_version_command", { p_command: "version.load", p_payload: { version_id: versionId } });
  const version = !result.error ? versionSchema.safeParse(result.data).data : null;
  if (version && version.procedure_id !== id) notFound();
  return <div className="space-y-5"><PageHeader title={version ? `Procedure version ${version.version_no}` : "Procedure version unavailable"} description={version ? `${version.status.replaceAll("_", " ")} / written by ${version.author_name}${version.reviewer_name ? ` / reviewed by ${version.reviewer_name}` : ""}` : "The version could not be loaded for this company."} actions={<Link className="text-sm font-bold underline" href={`/tasks/procedures/${id}/versions`}>Version history</Link>} />{version ? <section className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5"><p className="text-sm">{version.change_summary}</p><p className="text-xs text-slate-600">{version.effective_from ? `Effective from ${version.effective_from}. ` : "Not effective for execution. "}{version.withdraw_reason ?? version.review_note}</p><ol className="space-y-3">{version.steps.map((s, n) => <li key={n} className="rounded-2xl border border-slate-200 p-4 text-sm"><p className="font-bold">{n + 1}. {s.text}</p>{s.check ? <p className="mt-1">Key check: {s.check}</p> : null}</li>)}</ol>{version.status === "released" ? <Link className="inline-block text-sm font-bold underline" href={`/tasks/procedures/${id}/versions/${versionId}/execution`}>View execution rules</Link> : null}</section> : <p role="alert" className="rounded-2xl bg-amber-50 p-4 text-sm">Refresh to retry, or return to the procedure history.</p>}</div>;
}
