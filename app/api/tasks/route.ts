import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { logEnterpriseAuditEvent } from "@/lib/enterprise/audit";
import { createClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils/errors";
import { canAssignTasks } from "@/lib/auth/dealer-guards";

const taskSchema = z.object({
  title: z.string().min(2),
  description: z.string().optional(),
  assigned_to: z.string().uuid().optional(),
  due_date: z.string().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  dealership_id: z.string().uuid().optional(),
});

const taskUpdateSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["open", "in_progress", "completed", "cancelled"])
});

export async function POST(request: Request) {
  try {
    const context = await getSessionContext();
    if (!can(context.role, "create", "tasks")) return NextResponse.json({ error: "You do not have permission to create tasks." }, { status: 403 });
    
    const parsed = taskSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid task data" }, { status: 400 });

    const dealershipId = parsed.data.dealership_id ?? context.dealerId;
    if (context.dealerId && dealershipId !== context.dealerId) {
      return NextResponse.json({ error: "You can only create tasks for your own dealership." }, { status: 403 });
    }

    const supabase = await createClient();

    if (parsed.data.assigned_to) {
      const assignee = await supabase.from("app_users").select("id, dealer_id, role").eq("company_id", context.companyId).eq("id", parsed.data.assigned_to).single();
      if (assignee.error || !assignee.data) return NextResponse.json({ error: "Assigned user not found." }, { status: 400 });
      if (dealershipId && assignee.data.dealer_id !== dealershipId) return NextResponse.json({ error: "Dealer tasks can only be assigned to employees in the same dealership." }, { status: 403 });
      if (!dealershipId && assignee.data.dealer_id) return NextResponse.json({ error: "Set dealership before assigning a dealer employee." }, { status: 400 });
    }

    if (parsed.data.assigned_to && !canAssignTasks(context, dealershipId)) {
      return NextResponse.json({ error: "You do not have permission to assign tasks to others." }, { status: 403 });
    }
    
    const taskResult = await supabase.from("tasks").insert({
      company_id: context.companyId,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      assigned_to: parsed.data.assigned_to ?? null,
      created_by: context.userId,
      due_date: parsed.data.due_date ?? null,
      priority: parsed.data.priority,
      status: "open",
      dealership_id: dealershipId ?? null,
      assigned_by_user_id: context.userId
    }).select("*").single();

    if (taskResult.error || !taskResult.data) {
      return NextResponse.json({ error: getErrorMessage(taskResult.error, "Could not create task") }, { status: 500 });
    }

    await logEnterpriseAuditEvent(supabase, {
      companyId: context.companyId,
      actorUserId: context.userId,
      actorName: context.fullName ?? context.email,
      actorRole: context.role,
      actorDealerId: context.dealerId,
      actionType: "task_created",
      moduleName: "tasks",
      entityType: "task",
      entityId: taskResult.data.id,
      newValue: parsed.data,
      changeSummary: `Task "${parsed.data.title}" created`
    });

    return NextResponse.json({ task: taskResult.data });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, "Task creation failed") }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await getSessionContext();
    if (!can(context.role, "update", "tasks")) return NextResponse.json({ error: "You do not have permission to update tasks." }, { status: 403 });
    const parsed = taskUpdateSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid task update" }, { status: 400 });

    const supabase = await createClient();
    const existing = await supabase.from("tasks").select("id, dealership_id, assigned_to, created_by").eq("company_id", context.companyId).eq("id", parsed.data.id).single();
    if (existing.error || !existing.data) return NextResponse.json({ error: "Task not found." }, { status: 404 });
    if (context.dealerId && existing.data.dealership_id !== context.dealerId) return NextResponse.json({ error: "You can only update your dealership tasks." }, { status: 403 });
    if (context.role === "dealer_staff" && existing.data.assigned_to !== context.userId && existing.data.created_by !== context.userId) return NextResponse.json({ error: "Dealer staff can only update their own tasks." }, { status: 403 });

    const update: Record<string, string | null> = { status: parsed.data.status };
    update.completed_at = parsed.data.status === "completed" ? new Date().toISOString() : null;
    const result = await supabase.from("tasks").update(update).eq("company_id", context.companyId).eq("id", parsed.data.id).select("*").single();
    if (result.error || !result.data) return NextResponse.json({ error: getErrorMessage(result.error, "Could not update task") }, { status: 500 });
    return NextResponse.json({ task: result.data });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, "Task update failed") }, { status: 500 });
  }
}
