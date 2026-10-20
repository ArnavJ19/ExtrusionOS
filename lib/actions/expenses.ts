"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils/errors";
import {
  expensePaymentInputSchema, expenseTransitionInputSchema, manualExpenseInputSchema, settlementReversalInputSchema,
  supplierCreditInputSchema, type ExpensePaymentInput, type ManualExpenseInput, type SupplierCreditInput
} from "@/lib/financials/expenses";

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

function revalidateExpense(expenseId?: string | null) {
  revalidatePath("/expenses");
  revalidatePath("/expenses/database");
  revalidatePath("/expenses/pending-approvals");
  revalidatePath("/expenses/payments");
  revalidatePath("/expenses/payments/database");
  if (expenseId) revalidatePath(`/expenses/${expenseId}`);
  revalidatePath("/analytics");
}

async function financeContext(action: "create" | "update") {
  const context = await getSessionContext();
  if (!can(context.role, action, "financials")) throw new Error("You do not have permission to manage expenses.");
  return context;
}

export async function saveManualExpenseAction(input: ManualExpenseInput & { expense_id?: string | null; idempotency_key?: string | null }):
  Promise<ActionResult<{ expense_id: string; expense_number: string; approval_status: string; total_amount: number }>> {
  try {
    await financeContext(input.expense_id ? "update" : "create");
    const parsed = manualExpenseInputSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Check the expense details." };
    const ids = z.object({ expense_id: z.string().uuid().nullable().optional(), idempotency_key: z.string().uuid().nullable().optional() })
      .safeParse({ expense_id: input.expense_id ?? null, idempotency_key: input.idempotency_key ?? null });
    if (!ids.success || (!ids.data.expense_id && !ids.data.idempotency_key)) return { success: false, error: "Refresh the form and try again." };
    const supabase = await createClient();
    const result = await supabase.rpc("save_manual_expense_atomic", {
      p_expense_id: ids.data.expense_id ?? null,
      p_payload: parsed.data,
      p_idempotency_key: ids.data.expense_id ? null : ids.data.idempotency_key
    });
    if (result.error || !result.data) throw result.error ?? new Error("Expense was not saved");
    const data = result.data as { expense_id: string; expense_number: string; approval_status: string; total_amount: number };
    revalidateExpense(data.expense_id);
    return { success: true, data };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not save expense") };
  }
}

export async function transitionExpenseApprovalAction(input: { expense_id: string; action: string; note?: string | null }):
  Promise<ActionResult<{ expense_id: string; approval_status: string }>> {
  try {
    await financeContext("update");
    const parsed = expenseTransitionInputSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Check the approval details." };
    const supabase = await createClient();
    const result = await supabase.rpc("transition_expense_approval", {
      p_expense_id: parsed.data.expense_id, p_action: parsed.data.action, p_note: parsed.data.note ?? null
    });
    if (result.error || !result.data) throw result.error ?? new Error("Approval was not updated");
    revalidateExpense(parsed.data.expense_id);
    return { success: true, data: result.data as { expense_id: string; approval_status: string } };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not update expense approval") };
  }
}

export async function recordExpensePaymentAction(input: ExpensePaymentInput):
  Promise<ActionResult<{ payment_id: string; expense_id: string; balance_amount: number; payment_status: string; idempotent_replay: boolean }>> {
  try {
    await financeContext("create");
    const parsed = expensePaymentInputSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Check the payment details." };
    const { expense_id, idempotency_key, ...payment } = parsed.data;
    const supabase = await createClient();
    const result = await supabase.rpc("record_expense_payment_atomic", {
      p_expense_id: expense_id, p_payment: payment, p_idempotency_key: idempotency_key
    });
    if (result.error || !result.data) throw result.error ?? new Error("Supplier payment was not posted");
    const data = result.data as { payment_id: string; expense_id: string; balance_amount: number; payment_status: string; idempotent_replay: boolean };
    revalidateExpense(data.expense_id);
    revalidatePath(`/expenses/payments/${data.payment_id}`);
    return { success: true, data };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not post supplier payment") };
  }
}

export async function reverseExpensePaymentAction(input: { id: string; reason: string; idempotency_key: string }):
  Promise<ActionResult<{ expense_id: string }>> {
  try {
    await financeContext("update");
    const parsed = settlementReversalInputSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Check the reversal details." };
    const supabase = await createClient();
    const result = await supabase.rpc("reverse_expense_payment_atomic", {
      p_payment_id: parsed.data.id, p_reason: parsed.data.reason, p_idempotency_key: parsed.data.idempotency_key
    });
    if (result.error || !result.data) throw result.error ?? new Error("Supplier payment was not reversed");
    const data = result.data as { expense_id: string };
    revalidateExpense(data.expense_id);
    revalidatePath(`/expenses/payments/${parsed.data.id}`);
    return { success: true, data };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not reverse supplier payment") };
  }
}

export async function recordSupplierCreditAction(input: SupplierCreditInput):
  Promise<ActionResult<{ credit_id: string; expense_id: string; balance_amount: number; supplier_credit_due: number }>> {
  try {
    await financeContext("create");
    const parsed = supplierCreditInputSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Check the supplier credit details." };
    const { expense_id, idempotency_key, ...credit } = parsed.data;
    const supabase = await createClient();
    const result = await supabase.rpc("record_expense_supplier_credit_atomic", {
      p_expense_id: expense_id, p_credit: credit, p_idempotency_key: idempotency_key
    });
    if (result.error || !result.data) throw result.error ?? new Error("Supplier credit was not posted");
    const data = result.data as { credit_id: string; expense_id: string; balance_amount: number; supplier_credit_due: number };
    revalidateExpense(data.expense_id);
    return { success: true, data };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not post supplier credit") };
  }
}

export async function reverseSupplierCreditAction(input: { id: string; reason: string; idempotency_key: string }):
  Promise<ActionResult<{ expense_id: string }>> {
  try {
    await financeContext("update");
    const parsed = settlementReversalInputSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Check the reversal details." };
    const supabase = await createClient();
    const result = await supabase.rpc("reverse_expense_supplier_credit_atomic", {
      p_credit_id: parsed.data.id, p_reason: parsed.data.reason, p_idempotency_key: parsed.data.idempotency_key
    });
    if (result.error || !result.data) throw result.error ?? new Error("Supplier credit was not reversed");
    const data = result.data as { expense_id: string };
    revalidateExpense(data.expense_id);
    return { success: true, data };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not reverse supplier credit") };
  }
}

export type PayableExpenseOption = {
  id: string;
  expense_number: string;
  description: string | null;
  vendor_name_snapshot: string | null;
  invoice_number: string | null;
  total_amount: number;
  balance_amount: number;
  due_date: string | null;
};

const payableSearchSchema = z.object({ search: z.string().max(100).default(""), selectedId: z.string().uuid().nullable().optional() });

// Server-side search over approved expenses with an open balance, so payment entry never
// depends on a truncated client-side list (mirrors AR-08 for supplier payments).
export async function searchPayableExpensesAction(input: { search?: string; selectedId?: string | null }):
  Promise<ActionResult<{ rows: PayableExpenseOption[]; hasMore: boolean }>> {
  try {
    const context = await getSessionContext();
    if (!can(context.role, "read", "financials")) return { success: false, error: "Permission denied." };
    const parsed = payableSearchSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: "Invalid search." };
    const supabase = await createClient();
    let query = supabase.from("expense_ledger")
      .select("id, expense_number, description, vendor_name_snapshot, invoice_number, total_amount, balance_amount, due_date")
      .eq("company_id", context.companyId).eq("approval_status", "approved").is("deleted_at", null).gt("balance_amount", 0)
      .order("due_date", { ascending: true, nullsFirst: false }).order("expense_number", { ascending: true }).limit(26);
    if (parsed.data.selectedId) query = query.eq("id", parsed.data.selectedId);
    const term = parsed.data.search.replace(/[%,()*]/g, " ").trim();
    if (term && !parsed.data.selectedId) {
      query = query.or(["expense_number", "description", "vendor_name_snapshot", "invoice_number"].map((field) => `${field}.ilike.%${term}%`).join(","));
    }
    const result = await query;
    if (result.error) throw result.error;
    const rows = (result.data ?? []) as PayableExpenseOption[];
    return { success: true, data: { rows: rows.slice(0, 25), hasMore: rows.length > 25 } };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not search payable expenses") };
  }
}
