import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { ContinuityPolicy, ObservedTrialReview, ObservedTrialStart, RecoveryDecision, RecoveryRecord } from "@/components/modules/tasks/sop-assurance";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { continuityPolicySchema, recoveryListSchema, trialsListSchema } from "@/lib/workflow/guided-sop";
import { taskInstructionsSchema } from "@/lib/workflow/procedure-versions";

export default async function AssurancePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string }> }) {
  const [{ id }, query, c] = await Promise.all([params, searchParams, getSessionContext()]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  if (c.dealerId || !can(c.role, "read", "tasks")) redirect("/tasks");
  const page = Math.min(Math.max(Number.parseInt(query.page ?? "1", 10) || 1, 1), 100000);
  const client = await createClient();
  const rpc = (command: string) => client.rpc("sop_assurance_command", { p_command: command, p_payload: { task_id: id, ...(command.endsWith(".list") ? { page } : {}) } });
  const [p, r, t, ir, taskResult] = await Promise.all([rpc("policy.load"), rpc("recovery.list"), rpc("trial.list"), client.rpc("procedure_version_command", { p_command: "task.instructions", p_payload: { task_id: id } }), client.from("tasks").select("title,task_type,handoff_team,assigned_to").eq("id", id).eq("company_id", c.companyId).maybeSingle()]);
  const task = taskResult.data;
  const policy = !p.error ? continuityPolicySchema.safeParse(p.data?.policy).data ?? null : null;
  const notes = !r.error ? recoveryListSchema.safeParse(r.data).data : null;
  const trials = !t.error ? trialsListSchema.safeParse(t.data).data : null;
  const instructions = !ir.error ? taskInstructionsSchema.safeParse(ir.data).data : null;
  const manager = ["owner", "admin", "factory_manager", "production_manager", "quality", "dispatch_manager", "inventory_manager"].includes(c.role);
  const total = Math.max(notes?.total_count ?? 0, trials?.total_count ?? 0);
  return <div className="space-y-5"><PageHeader title={task ? `${task.title}: continuity and observed work` : "Continuity and observed work"} description="Keep numbered outage observations separate from confirmed transactions. Validate the written SOP by observing an employee doing the actual work." actions={<Link className="text-sm font-bold underline" href={`/tasks/${id}/execute`}>Guided procedure</Link>} />{task ? <><ContinuityPolicy policy={policy} taskKind={task.handoff_team ? `handoff:${task.handoff_team}` : `type:${task.task_type}`} canManage={["owner", "admin", "factory_manager"].includes(c.role)} />{policy && (manager || task.assigned_to === c.userId) ? <section className="rounded-3xl border border-slate-200 bg-white p-5"><h2 className="mb-3 font-bold">Record an outage observation</h2><RecoveryRecord taskId={id} /></section> : null}<section className="space-y-3"><h2 className="font-bold">Recovery records</h2>{notes ? notes.rows.length ? notes.rows.map(n => <RecoveryDecision key={n.id + n.status} item={n} canDecide={n.recorded_by !== c.userId && (["owner", "admin"].includes(c.role) || n.policy_snapshot.reconcile_role === c.role)} />) : <p className="text-sm">No recovery records on this page.</p> : <p role="alert">Recovery records could not be loaded.</p>}</section><section className="space-y-3"><h2 className="font-bold">Observed employee work</h2>{manager ? <ObservedTrialStart taskId={id} /> : null}{trials ? trials.rows.length ? trials.rows.map(x => <ObservedTrialReview key={`${x.id}:${x.revision}`} trial={x} instructions={instructions?.bound ? instructions.version.steps : []} userId={c.userId} canReview={x.can_review} />) : <p className="text-sm">No observed trials on this page.</p> : <p role="alert">Observed trials could not be loaded.</p>}</section>{total > 10 ? <nav className="flex justify-between text-sm">{page > 1 ? <Link href={`?page=${page - 1}`}>Previous</Link> : <span />}<span>Page {page}</span>{page * 10 < total ? <Link href={`?page=${page + 1}`}>Next</Link> : <span />}</nav> : null}</> : <p role="alert">The task could not be loaded.</p>}</div>;
}
