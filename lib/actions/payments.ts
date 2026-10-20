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
  amount: z.coerce.number().finite("Enter a finite payment amount").positive("Amount must be greater than zero"),
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
    if (!can(context.role, "create", "financials")) {
      return { success: false, error: "You do not have permission to record payments." };
    }

    const parsed = recordPaymentInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Please check payment details." };
    }

    const supabase = await createClient();
    const { data: invoice, error: invoiceError } = await supabase
      .from("invoices")
      .select("id")
      .eq("company_id", context.companyId)
      .eq("id", parsed.data.invoice_id)
      .maybeSingle();
    if (invoiceError) throw invoiceError;
    if (!invoice) return { success: false, error: "Invoice not found for this company." };
    // The locked transaction must resolve retries before checking the current balance and status.
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
    if (!can(context.role, "update", "financials")) {
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

const refundInputSchema = z.object({
  invoice_id: z.string().uuid("Select an invoice"),
  amount: z.coerce.number().finite("Enter a finite refund amount").positive("Refund must be greater than zero"),
  refund_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Refund date is required"),
  payment_method: z.enum(["bank_transfer", "upi", "cheque", "cash", "other"], { errorMap: () => ({ message: "Select how the refund was paid" }) }),
  reference_number: z.string().trim().max(120).optional().nullable(),
  notes: z.string().trim().min(5, "Enter a clear refund reason").max(2000),
  credit_note_id: z.string().uuid().optional().nullable(),
  idempotency_key: z.string().uuid()
}).superRefine((value, ctx) => {
  if (["bank_transfer", "upi", "cheque"].includes(value.payment_method) && !value.reference_number) {
    ctx.addIssue({ code: "custom", path: ["reference_number"], message: "Reference number is required for bank, UPI and cheque refunds." });
  }
});
export type CustomerRefundInput = z.input<typeof refundInputSchema>;

// Records money returned to a customer against customer credit due (AR-02).
export async function recordCustomerRefundAction(input: CustomerRefundInput):
  Promise<{ success: true; data: { payment_id: string; invoice_id: string; customer_credit_due: number } } | { success: false; error: string }> {
  try {
    const context = await getSessionContext();
    if (!can(context.role, "create", "financials")) return { success: false, error: "You do not have permission to record refunds." };
    const parsed = refundInputSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Please check refund details." };
    const { invoice_id, idempotency_key, ...refund } = parsed.data;
    const supabase = await createClient();
    const result = await supabase.rpc("record_customer_refund_atomic", {
      p_invoice_id: invoice_id,
      p_refund: { ...refund, reference_number: refund.reference_number || null, credit_note_id: refund.credit_note_id || null },
      p_idempotency_key: idempotency_key
    });
    if (result.error || !result.data) throw result.error ?? new Error("Could not record refund");
    const data = result.data as { payment_id: string; invoice_id: string; customer_credit_due: number };
    revalidatePaymentPaths(data.payment_id, data.invoice_id);
    revalidatePath("/dispatches");
    return { success: true, data };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not record refund") };
  }
}

export type OpenInvoiceOption = {
  id: string;
  invoice_number: string | null;
  invoice_date: string;
  due_date: string | null;
  grand_total: number;
  amount_paid: number;
  credited_amount: number;
  balance_due: number;
  status: string;
  customer_name: string | null;
  order_number: string | null;
};

const openInvoiceSearchSchema = z.object({ search: z.string().max(100).default(""), selectedId: z.string().uuid().nullable().optional() });

// Server-side search over issued invoices with an open balance (AR-08). A deep-linked
// invoice is resolved by ID, independent of any page of results.
export async function searchOpenInvoicesAction(input: { search?: string; selectedId?: string | null }):
  Promise<{ success: true; data: { rows: OpenInvoiceOption[]; hasMore: boolean } } | { success: false; error: string }> {
  try {
    const context = await getSessionContext();
    if (!can(context.role, "read", "financials")) return { success: false, error: "Permission denied." };
    const parsed = openInvoiceSearchSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: "Invalid search." };
    const supabase = await createClient();
    let query = supabase.from("invoices")
      .select("id, invoice_number, invoice_date, due_date, grand_total, amount_paid, credited_amount, balance_due, status, customers(customer_name, company_name), orders(order_number)")
      .eq("company_id", context.companyId).in("status", ["generated", "sent", "partially_paid", "overdue"]).gt("balance_due", 0)
      .order("due_date", { ascending: true, nullsFirst: false }).order("invoice_number", { ascending: true }).limit(26);
    if (parsed.data.selectedId) {
      query = query.eq("id", parsed.data.selectedId);
    } else {
      const term = parsed.data.search.replace(/[%,()*]/g, " ").trim();
      if (term) {
        const customers = await supabase.from("customers").select("id").eq("company_id", context.companyId)
          .or(`customer_name.ilike.%${term}%,company_name.ilike.%${term}%`).limit(50);
        if (customers.error) throw customers.error;
        const customerIds = (customers.data ?? []).map((row) => row.id);
        query = query.or([`invoice_number.ilike.%${term}%`, customerIds.length ? `customer_id.in.(${customerIds.join(",")})` : null].filter(Boolean).join(","));
      }
    }
    const result = await query;
    if (result.error) throw result.error;
    const one = <T,>(value: T | T[] | null | undefined) => (Array.isArray(value) ? value[0] ?? null : value ?? null);
    const rows = ((result.data ?? []) as any[]).map((row) => {
      const customer = one(row.customers) as { customer_name?: string | null; company_name?: string | null } | null;
      return {
        id: row.id, invoice_number: row.invoice_number, invoice_date: row.invoice_date, due_date: row.due_date,
        grand_total: Number(row.grand_total ?? 0), amount_paid: Number(row.amount_paid ?? 0), credited_amount: Number(row.credited_amount ?? 0),
        balance_due: Number(row.balance_due ?? 0), status: row.status,
        customer_name: customer?.company_name || customer?.customer_name || null,
        order_number: (one(row.orders) as { order_number?: string | null } | null)?.order_number ?? null
      } satisfies OpenInvoiceOption;
    });
    return { success: true, data: { rows: rows.slice(0, 25), hasMore: rows.length > 25 } };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not search open invoices") };
  }
}
