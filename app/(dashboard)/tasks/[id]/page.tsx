import { RecordDetailClient } from "@/components/modules/operations/record-detail-client";
import { TaskTurnaroundPanel } from "@/components/modules/tasks/turnaround";
import { TaskCriteriaPanel } from "@/components/modules/tasks/completion-criteria";
import { TaskInstructionsPanel } from "@/components/modules/tasks/procedure-versions";
import { TaskBlueprintPanel } from "@/components/modules/tasks/task-blueprints";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { WAIT_SUPERVISORS, turnaroundStatusSchema, type TurnaroundStatus } from "@/lib/workflow/turnaround";
import { canSuperviseCriteria, evaluationSchema, type CriteriaEvaluation } from "@/lib/workflow/completion-criteria";
import { taskInstructionsSchema, type TaskInstructions } from "@/lib/workflow/procedure-versions";
import { taskBlueprintSchema, type TaskBlueprintView } from "@/lib/workflow/task-blueprints";
import { redirect } from "next/navigation";
import Link from "next/link";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await getSessionContext();
  if (!can(context.role, "read", "tasks")) redirect("/tasks");
  const { id } = await params;
  // UPGRADE_EOS feature 71: turnaround for internal tasks (absent before the upgrade and for dealer tasks).
  let turnaround: TurnaroundStatus | null = null;
  let assignee: string | null = null;
  // UPGRADE_EOS feature 67: the business outcome the task must reach before it can be completed.
  let criteria: CriteriaEvaluation | null = null;
  let taskRow: { status: string; assigned_to: string | null; related_entity_type: string | null } | null = null;
  // UPGRADE_EOS feature 77: the procedure version this task follows (absent before the upgrade).
  let instructions: TaskInstructions | null = null;
  // UPGRADE_EOS feature 61: the task kind's blueprint and whether its start prerequisites hold now.
  let blueprint: Extract<TaskBlueprintView, { has_blueprint: true }> | null = null;
  if (!context.dealerId && UUID.test(id)) {
    const supabase = await createClient();
    const [statusResult, taskResult, criteriaResult, instructionsResult, blueprintResult] = await Promise.all([
      supabase.rpc("turnaround_command", { p_command: "task.status", p_payload: { task_ids: [id] } }),
      supabase.from("tasks").select("assigned_to, status, related_entity_type").eq("company_id", context.companyId).eq("id", id).maybeSingle(),
      supabase.rpc("task_criteria_command", { p_command: "task.evaluate", p_payload: { task_id: id } }),
      supabase.rpc("procedure_version_command", { p_command: "task.instructions", p_payload: { task_id: id } }),
      supabase.rpc("task_blueprint_command", { p_command: "task.blueprint", p_payload: { task_id: id } })
    ]);
    const parsed = statusResult.error ? null : turnaroundStatusSchema.safeParse(statusResult.data);
    turnaround = parsed?.success ? parsed.data[0] ?? null : null;
    assignee = taskResult.data?.assigned_to ?? null;
    taskRow = taskResult.data ?? null;
    const criteriaParsed = criteriaResult.error ? null : evaluationSchema.safeParse(criteriaResult.data);
    criteria = criteriaParsed?.success ? criteriaParsed.data : null;
    const instructionsParsed = instructionsResult.error ? null : taskInstructionsSchema.safeParse(instructionsResult.data);
    const blueprintParsed = blueprintResult.error ? null : taskBlueprintSchema.safeParse(blueprintResult.data);
    blueprint = blueprintParsed?.success && blueprintParsed.data.has_blueprint ? blueprintParsed.data : null;
    instructions = instructionsParsed?.success && (instructionsParsed.data.bound || instructionsParsed.data.reason !== "not_mapped") ? instructionsParsed.data : null;
  }
  return (
    <div className="space-y-6">
      <RecordDetailClient moduleKey="tasks" recordId={id} context={context} canEdit={can(context.role, "update", "tasks")} />
      {!context.dealerId ? <nav className="flex flex-wrap gap-3 text-sm font-bold"><Link className="rounded-xl border border-slate-200 bg-white px-4 py-3" href={`/tasks/${id}/execute`}>Guided procedure</Link><Link className="rounded-xl border border-slate-200 bg-white px-4 py-3" href={`/tasks/${id}/assurance`}>Continuity and observed work</Link></nav> : null}
      {blueprint ? <TaskBlueprintPanel view={blueprint} taskId={id} /> : null}
      {instructions ? <TaskInstructionsPanel instructions={instructions} taskId={id} canFlag={context.role !== "viewer"} /> : null}
      {criteria && taskRow ? <TaskCriteriaPanel evaluation={criteria} viewer={{ userId: context.userId, role: context.role, supervisor: canSuperviseCriteria(context.role) }} task={{ id, ...taskRow }} /> : null}
      {turnaround ? <TaskTurnaroundPanel initial={turnaround} canRecordWait={assignee === context.userId || (WAIT_SUPERVISORS as readonly string[]).includes(context.role)} /> : null}
    </div>
  );
}
