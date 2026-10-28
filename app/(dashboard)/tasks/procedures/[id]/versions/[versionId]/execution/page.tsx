import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { ExecutionPlanEditor } from "@/components/modules/tasks/guided-sop";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { planLoadSchema } from "@/lib/workflow/guided-sop";
import { versionSchema } from "@/lib/workflow/procedure-versions";

export default async function ExecutionPlanPage({ params }: { params: Promise<{ id: string; versionId: string }> }) {
  const [{ id, versionId }, c] = await Promise.all([params, getSessionContext()]);
  if (![id, versionId].every(s => /^[0-9a-f-]{36}$/i.test(s))) notFound();
  if (c.dealerId || !can(c.role, "read", "tasks")) redirect("/tasks");
  const client = await createClient();
  const [result, vr] = await Promise.all([client.rpc("guided_sop_command", { p_command: "plan.load", p_payload: { version_id: versionId } }), client.rpc("procedure_version_command", { p_command: "version.load", p_payload: { version_id: versionId } })]);
  const data = !result.error ? planLoadSchema.safeParse(result.data).data : null;
  const version = !vr.error ? versionSchema.safeParse(vr.data).data : null;
  if (version && version.procedure_id !== id) notFound();
  return <div className="space-y-5"><PageHeader title={`Execution rules${version ? ` / version ${version.version_no}` : ""}`} description="Define the evidence, approved decision boundaries and independent verification roles. Another process reviewer must release the plan." actions={<Link className="text-sm font-bold underline" href={`/tasks/procedures/${id}/versions`}>Procedure versions</Link>} /><section className="rounded-3xl border border-slate-200 bg-white p-5">{data ? <ExecutionPlanEditor key={data.plan?.revision ?? "new"} versionId={versionId} data={data} userId={c.userId} /> : <p role="alert">Execution rules could not be loaded. Refresh to retry.</p>}</section></div>;
}
