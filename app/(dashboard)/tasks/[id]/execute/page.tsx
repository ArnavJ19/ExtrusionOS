import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { GuidedExecution } from "@/components/modules/tasks/guided-sop";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { runViewSchema } from "@/lib/workflow/guided-sop";
import { taskInstructionsSchema } from "@/lib/workflow/procedure-versions";

export default async function ExecutePage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, c] = await Promise.all([params, getSessionContext()]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  if (c.dealerId || !can(c.role, "read", "tasks")) redirect("/tasks");
  const client = await createClient();
  const [rr, ir] = await Promise.all([client.rpc("guided_sop_command", { p_command: "run.load", p_payload: { task_id: id } }), client.rpc("procedure_version_command", { p_command: "task.instructions", p_payload: { task_id: id } })]);
  const view = !rr.error ? runViewSchema.safeParse(rr.data).data : null;
  const instructions = !ir.error ? taskInstructionsSchema.safeParse(ir.data).data : null;
  return <div className="space-y-5"><PageHeader title="Guided procedure" description={instructions?.bound ? `${instructions.procedure_title} / version ${instructions.version.version_no}` : "Follow the reviewed instructions and retain the evidence for each step."} actions={<div className="flex gap-3 text-sm font-bold"><Link className="underline" href={`/tasks/${id}`}>Task</Link><Link className="underline" href={`/tasks/${id}/assurance`}>Outage recovery and observed trials</Link></div>} /><section className="rounded-3xl border border-slate-200 bg-white p-5">{view && instructions?.bound ? <GuidedExecution key={`${view.run?.id ?? "new"}:${view.run?.revision ?? 0}`} taskId={id} view={view} instructions={instructions.version.steps} userId={c.userId} role={c.role} /> : <p role="alert">{rr.error ? "Guided work could not be loaded. Contact your administrator if refreshing does not resolve it." : "This task has no released procedure. The process owner must publish instructions and execution rules first."}</p>}</section></div>;
}
