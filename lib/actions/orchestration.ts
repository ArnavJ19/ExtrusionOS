"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  ORCHESTRATION_MUTATIONS, canReadOrchestration, canWriteDiePreparation, diePreparationCommandSchema, orchestrationCommandSchema, presentableDatabaseMessage,
  type ActionResult
} from "@/lib/workflow/orchestration";
import { CONTAINMENT_MUTATIONS, PRIORITY_MUTATIONS, REMELT_MUTATIONS, containmentCommandSchema, priorityCommandSchema, remeltCommandSchema } from "@/lib/workflow/nonconforming";
import { DISPATCH_COMM_MUTATIONS, DISPATCH_FINANCE_MUTATIONS, dispatchCommCommandSchema, dispatchFinanceCommandSchema } from "@/lib/workflow/dispatch-orchestration";
import { REVERSAL_MUTATIONS, reversalCommandSchema } from "@/lib/workflow/quality-reversal";
import { FINAL_QC_MUTATIONS, finalQcCommandSchema } from "@/lib/workflow/final-qc";
import { PACKAGING_FLOW_MUTATIONS, packagingFlowCommandSchema } from "@/lib/workflow/packaging-flow";
import {
  CLOSURE_MUTATIONS, COMPLAINT_MUTATIONS, DELIVERY_MUTATIONS, RECEIVABLE_MUTATIONS, closureCommandSchema, complaintCommandSchema, deliveryCommandSchema, receivableCommandSchema
} from "@/lib/workflow/delivery-closure";

const UNAVAILABLE = "Order lifecycle orchestration needs the database upgrade 20261120100000 to be applied first. Existing workflows remain available.";

function mapError(code: string, message: string, mutation: boolean): ActionResult<never> {
  if (["PGRST202", "42883", "42P01"].includes(code)) return { success: false, unavailable: true, error: UNAVAILABLE };
  // Refusals raised by the orchestration functions explain who may act; engine-level denials stay generic.
  if (code === "42501") return { success: false, error: /permission denied|row-level security|authentication required/i.test(message) || !message ? "This action is not permitted for your current session." : message };
  const shown = presentableDatabaseMessage(code, message);
  if (shown) return { success: false, error: shown };
  if (code === "55P03") return { success: false, error: "A production record is being changed by someone else. Refresh and retry." };
  if (["23505", "23503", "22P02", "22007", "22008", "22003", "23514"].includes(code)) return { success: false, error: "The details conflict with current records. Refresh and review the action again." };
  return { success: false, uncertain: mutation, error: mutation ? "Confirmation is unavailable. Refresh to check whether the change was recorded before retrying." : "The information could not be loaded. Retry to check it." };
}

function refresh(paths: string[]) {
  for (const path of paths) {
    try { revalidatePath(path); } catch { /* A confirmed write stays confirmed if cache refresh fails. */ }
  }
}

/** Company, actor and role come from the session; the database rechecks every permission and rule. */
export async function orchestrationAction(input: unknown): Promise<ActionResult> {
  let mutation = false;
  let submitted = false;
  try {
    const parsed = orchestrationCommandSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Review the request details." };
    const context = await getSessionContext();
    if (context.dealerId || !canReadOrchestration(context.role)) return { success: false, error: "This action is not permitted for your current session." };
    const { command, ...payload } = parsed.data;
    mutation = ORCHESTRATION_MUTATIONS.has(command);
    const supabase = await createClient();
    submitted = true;
    const result = await supabase.rpc("olo_command", { p_command: command, p_payload: payload });
    if (result.error) return mapError(result.error.code ?? "", result.error.message ?? "", mutation);
    if (mutation) refresh(["/tasks/orchestration", "/orders/lifecycle", "/production/order-book", "/dies/preparation", "/settings/orchestration", "/notifications"]);
    return { success: true, data: result.data };
  } catch {
    return { success: false, uncertain: mutation && submitted, error: mutation && submitted ? "Confirmation is unavailable. Refresh to check whether the change was recorded before retrying." : "The request could not be completed. Check your session and retry." };
  }
}

export async function diePreparationAction(input: unknown): Promise<ActionResult> {
  let mutation = false;
  let submitted = false;
  try {
    const parsed = diePreparationCommandSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Review the request details." };
    const context = await getSessionContext();
    const { command, ...payload } = parsed.data;
    mutation = command !== "prep.list" && command !== "prep.get";
    if (context.dealerId || !canReadOrchestration(context.role) || (mutation && !canWriteDiePreparation(context.role))) {
      return { success: false, error: "Only the tool room and production managers record die preparation." };
    }
    const supabase = await createClient();
    submitted = true;
    const result = await supabase.rpc("die_preparation_command", { p_command: command, p_payload: payload });
    if (result.error) return mapError(result.error.code ?? "", result.error.message ?? "", mutation);
    if (mutation) refresh(["/dies/preparation", "/production/order-book", "/tasks/orchestration", "/orders/lifecycle"]);
    return { success: true, data: result.data };
  } catch {
    return { success: false, uncertain: mutation && submitted, error: mutation && submitted ? "Confirmation is unavailable. Refresh to check whether the step was recorded before retrying." : "The request could not be completed. Check your session and retry." };
  }
}

// Orchestration batch 2: QC containment, remelt approvals and priority requests. Each RPC rechecks the role.
type Schema = { safeParse: (input: unknown) => { success: true; data: { command: string } & Record<string, unknown> } | { success: false; error: { issues: { message: string }[] } } };
async function runCommand(rpc: string, schema: Schema, mutations: Set<string>, input: unknown, paths: string[], unavailable: string): Promise<ActionResult> {
  let mutation = false;
  let submitted = false;
  try {
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Review the request details." };
    const context = await getSessionContext();
    if (context.dealerId || !canReadOrchestration(context.role)) return { success: false, error: "This action is not permitted for your current session." };
    const { command, ...payload } = parsed.data;
    mutation = mutations.has(command);
    const supabase = await createClient();
    submitted = true;
    const result = await supabase.rpc(rpc, { p_command: command, p_payload: payload });
    if (result.error) {
      const mapped = mapError(result.error.code ?? "", result.error.message ?? "", mutation);
      return mapped.success === false && mapped.unavailable ? { ...mapped, error: unavailable } : mapped;
    }
    if (mutation) refresh(paths);
    return { success: true, data: result.data };
  } catch {
    return { success: false, uncertain: mutation && submitted, error: mutation && submitted ? "Confirmation is unavailable. Refresh to check whether the change was recorded before retrying." : "The request could not be completed. Check your session and retry." };
  }
}
const UNAVAILABLE_B2 = "This workflow needs the database upgrade 20261120200000 to be applied first. Existing workflows remain available.";

export async function containmentAction(input: unknown): Promise<ActionResult> {
  return runCommand("quality_containment_command", containmentCommandSchema as unknown as Schema, CONTAINMENT_MUTATIONS, input,
    ["/quality/containment", "/quality", "/orders/lifecycle", "/tasks/orchestration", "/foundry/remelt"], UNAVAILABLE_B2);
}
export async function remeltAction(input: unknown): Promise<ActionResult> {
  return runCommand("remelt_command", remeltCommandSchema as unknown as Schema, REMELT_MUTATIONS, input, ["/foundry/remelt", "/foundry/scrap", "/tasks/orchestration", "/orders/lifecycle"], UNAVAILABLE_B2);
}
export async function priorityAction(input: unknown): Promise<ActionResult> {
  return runCommand("priority_request_command", priorityCommandSchema as unknown as Schema, PRIORITY_MUTATIONS, input, ["/orders/priority-requests", "/orders/lifecycle", "/tasks/orchestration", "/production/order-book"], UNAVAILABLE_B2);
}

// Orchestration batch 3 (migration 20261122100000): dispatch finance clearance and customer dispatch updates.
const UNAVAILABLE_B3 = "This workflow needs the database upgrade 20261122100000 to be applied first. Existing workflows remain available.";
export async function dispatchFinanceAction(input: unknown): Promise<ActionResult> {
  return runCommand("dispatch_finance_command", dispatchFinanceCommandSchema as unknown as Schema, DISPATCH_FINANCE_MUTATIONS, input,
    ["/dispatches/clearance", "/dispatches", "/orders/lifecycle", "/tasks/orchestration"], UNAVAILABLE_B3);
}
export async function dispatchCommAction(input: unknown): Promise<ActionResult> {
  return runCommand("dispatch_comm_command", dispatchCommCommandSchema as unknown as Schema, DISPATCH_COMM_MUTATIONS, input,
    ["/dispatches/communications", "/dispatches", "/orders/lifecycle", "/tasks/orchestration", "/communications/whatsapp"], UNAVAILABLE_B3);
}

// Orchestration Phase 4 (migration 20261123100000): QC reversal of an earlier approval.
const UNAVAILABLE_P4 = "QC reversal needs the database upgrade 20261123100000 to be applied first. Existing workflows remain available.";
export async function qualityReversalAction(input: unknown): Promise<ActionResult> {
  return runCommand("quality_reversal_command", reversalCommandSchema as unknown as Schema, REVERSAL_MUTATIONS, input,
    ["/quality/reversals", "/quality", "/quality/containment", "/foundry/remelt", "/orders/lifecycle", "/tasks/orchestration"], UNAVAILABLE_P4);
}

// Orchestration Phase 5 (migration 20261124100000): final QC after ageing.
const UNAVAILABLE_P5 = "Final QC after ageing needs the database upgrade 20261124100000 to be applied first. Existing workflows remain available.";
export async function finalQcAction(input: unknown): Promise<ActionResult> {
  return runCommand("final_qc_command", finalQcCommandSchema as unknown as Schema, FINAL_QC_MUTATIONS, input,
    ["/quality/final-qc", "/quality", "/quality/reversals", "/foundry/remelt", "/orders/lifecycle", "/tasks/orchestration", "/packaging"], UNAVAILABLE_P5);
}

// Orchestration Phase 6 (migration 20261125100000): packaging release, bundle trace and finished-goods transfers.
const UNAVAILABLE_P6 = "Packaging release, bundle trace and finished-goods transfers need the database upgrade 20261125100000 to be applied first. Existing workflows remain available.";
export async function packagingFlowAction(input: unknown): Promise<ActionResult> {
  return runCommand("packaging_flow_command", packagingFlowCommandSchema as unknown as Schema, PACKAGING_FLOW_MUTATIONS, input,
    ["/packaging", "/packaging/release", "/packaging/bundles", "/packaging/fg-transfers", "/dispatches/loading", "/orders/lifecycle", "/tasks/orchestration"], UNAVAILABLE_P6);
}

// Orchestration Phase 7 (migration 20261126100000): delivery and closure. Each RPC rechecks the role; receivables are
// finance only in the database.
const UNAVAILABLE_P7 = "Delivery tracking, complaints, payment follow-up and closure need the database upgrade 20261126100000 to be applied first. Existing workflows remain available.";
export async function deliveryTrackingAction(input: unknown): Promise<ActionResult> {
  return runCommand("delivery_tracking_command", deliveryCommandSchema as unknown as Schema, DELIVERY_MUTATIONS, input,
    ["/dispatches/deliveries", "/dispatches", "/orders/lifecycle", "/orders/closure", "/tasks/orchestration"], UNAVAILABLE_P7);
}
export async function complaintAction(input: unknown): Promise<ActionResult> {
  return runCommand("customer_complaint_command", complaintCommandSchema as unknown as Schema, COMPLAINT_MUTATIONS, input,
    ["/quality/complaints", "/quality", "/dispatches/deliveries", "/orders/lifecycle", "/orders/closure", "/tasks/orchestration"], UNAVAILABLE_P7);
}
export async function receivableFollowupAction(input: unknown): Promise<ActionResult> {
  return runCommand("receivable_followup_command", receivableCommandSchema as unknown as Schema, RECEIVABLE_MUTATIONS, input,
    ["/payments/follow-up", "/payments", "/orders/closure", "/orders/lifecycle", "/tasks/orchestration"], UNAVAILABLE_P7);
}
export async function orderClosureAction(input: unknown): Promise<ActionResult> {
  return runCommand("order_closure_command", closureCommandSchema as unknown as Schema, CLOSURE_MUTATIONS, input,
    ["/orders/closure", "/orders/lifecycle", "/tasks/orchestration", "/tasks/lifecycle"], UNAVAILABLE_P7);
}
