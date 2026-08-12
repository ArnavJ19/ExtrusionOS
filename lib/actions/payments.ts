"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils/errors";

const recordPaymentInputSchema = z.object({
  invoice_id: z.string().uuid("Select an invoice"),
  payment_date: z.string().min(1, "Payment date is required"),
  amount: z.coerce.number().positive("Amount must be greater than zero"),
  payment_method: z.enum(["bank_transfer", "upi", "cheque", "cash", "credit_note", "other"]),
  reference_number: z.string().trim().max(120).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  idempotency_key: z.string().uuid()
});

const reversePaymentInputSchema = z.object({
  payment_id: z.string().uuid(),
  reason: z.string().trim().min(5, "Enter a clear reversal reason").max(1000),
  idempotency_key: z.string().uuid()
});

export type RecordPaymentInput = z.input<typeof recordPaymentInputSchema>;
export type ReversePaymentInput = z.input<typeof reversePaymentInputSchema>;

type PaymentWorkflowResult = {
  payment_id: string;
  invoice_id: string;
  amount_paid: number;
  balance_due: number;
  invoice_status: string;
  idempotent_replay: boolean;
};

type PaymentActionResult =
  | { success: true; data: PaymentWorkflowResult }
  | { success: false; error: string };

function revalidatePaymentPaths(paymentId: string, invoiceId: string) {
  revalidatePath("/payments");
  revalidatePath("/payments/database");
  revalidatePath(`/payments/${paymentId}`);
  revalidatePath("/invoices");
  revalidatePath("/invoices/database");
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/analytics");
  revalidatePath("/dashboard");
}

export async function recordPaymentAction(input: RecordPaymentInput): Promise<PaymentActionResult> {
  try {
    const context = await getSessionContext();
    if (!can(context.role, "create", "payments", context.permissions)) {
      return { success: false, error: "You do not have permission to record payments." };
    }

    const parsed = recordPaymentInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Please check payment details." };
    }

    const supabase = await createClient();
    const { data: invoice, error: invoiceError } = await supabase
      .from("invoices")
      .select("id, customer_id, order_id, balance_due, status")
      .eq("company_id", context.companyId)
      .eq("id", parsed.data.invoice_id)
      .maybeSingle();
    if (invoiceError) throw invoiceError;
    if (!invoice) return { success: false, error: "Invoice not found for this company." };
    if (!["generated", "sent", "partially_paid", "overdue"].includes(String(invoice.status))) {
      return { success: false, error: "Payments can only be posted to an issued, unpaid invoice." };
    }
    if (parsed.data.amount > Number(invoice.balance_due ?? 0)) {
      return { success: false, error: "Payment amount exceeds the outstanding invoice balance." };
    }

    const result = await supabase.rpc("record_payment_atomic", {
      p_invoice_id: parsed.data.invoice_id,
      p_payment: {
        payment_date: parsed.data.payment_date,
        amount: parsed.data.amount,
        payment_method: parsed.data.payment_method,
        reference_number: parsed.data.reference_number || null,
        notes: parsed.data.notes || null,
        idempotency_key: parsed.data.idempotency_key
      }
    });
    if (result.error || !result.data) throw result.error ?? new Error("Could not record payment");

    const data = result.data as PaymentWorkflowResult;
    revalidatePaymentPaths(data.payment_id, data.invoice_id);
    return { success: true, data };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not record payment") };
  }
}

export async function reversePaymentAction(input: ReversePaymentInput): Promise<PaymentActionResult> {
  try {
    const context = await getSessionContext();
    if (!can(context.role, "update", "payments", context.permissions)) {
      return { success: false, error: "You do not have permission to reverse payments." };
    }

    const parsed = reversePaymentInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Please check reversal details." };
    }

    const supabase = await createClient();
    const result = await supabase.rpc("reverse_payment_atomic", {
      p_payment_id: parsed.data.payment_id,
      p_reason: parsed.data.reason,
      p_idempotency_key: parsed.data.idempotency_key
    });
    if (result.error || !result.data) throw result.error ?? new Error("Could not reverse payment");

    const data = result.data as PaymentWorkflowResult;
    revalidatePaymentPaths(data.payment_id, data.invoice_id);
    return { success: true, data };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not reverse payment") };
  }
}
