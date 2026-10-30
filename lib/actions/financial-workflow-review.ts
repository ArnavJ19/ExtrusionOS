"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { buildInvoiceItems } from "@/lib/pcda/invoice";
import { applyInvoiceSourceTaxBasis, loadInvoiceSourceOptions } from "@/lib/financials/invoice-sources";
import { createClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils/errors";
import {
  buildInvoiceFingerprintPayload,
  correctionApplyInputSchema,
  correctionPreviewSchema,
  financialInvoiceReviewSchema,
  receivableInvoiceSchema,
  receiptAllocationInputSchema,
  receiptCsvMappingSchema,
  receiptImportResultSchema,
  receiptPostingResultSchema,
  type ReceiptCsvMapping,
  previewReceiptCsv
} from "@/lib/workflow/financial-workflow-review";

const uuid = z.string().uuid();
const searchSchema = z.object({ search: z.string().trim().max(100).default("") }).strict();
const dispatchSearchSchema = z.object({
  order_id: uuid,
  search: z.string().trim().max(100).default(""),
  selected_id: uuid.nullable().optional()
}).strict();
const reviewDispatchSchema = z.object({ order_id: uuid, dispatch_id: uuid }).strict();
const receivableSearchSchema = z.object({ search: z.string().trim().max(100).default("") }).strict();
const postReceiptSchema = z.object({
  amount: z.number().finite().positive().max(999_999_999_999.99),
  payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  payment_method: z.enum(["bank_transfer", "upi", "cheque", "cash", "credit_note", "other"]),
  reference_number: z.string().trim().max(120).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  idempotency_key: uuid,
  allocations: z.array(receiptAllocationInputSchema).min(1).max(100)
}).strict();
const csvImportSchema = z.object({
  csv_text: z.string().min(1).max(512_000),
  source_name: z.string().trim().min(1).max(160),
  mapping: receiptCsvMappingSchema
}).strict();
const correctionPreviewRequestSchema = z.object({ record_type: z.enum(["invoice", "payment"]), record_id: uuid }).strict();

export type InvoiceEligibilityOrdersResult =
  | { success: true; rows: Awaited<ReturnType<typeof loadInvoiceSourceOptions>> extends infer T ? T extends { rows: infer R } ? R : never : never; hasMore: boolean }
  | { success: false; error: string };

export async function searchInvoiceEligibilityOrdersAction(input: { search?: string }) {
  try {
    const context = await getSessionContext();
    if (!can(context.role, "read", "financials")) return { success: false as const, error: "You do not have permission to inspect invoice sources." };
    const parsed = searchSchema.safeParse(input);
    if (!parsed.success) return { success: false as const, error: "Enter an order search of at most 100 characters." };
    const options = await loadInvoiceSourceOptions(await createClient(), {
      kind: "order", search: parsed.data.search, orderId: null, invoiceId: null, selectedId: null
    });
    if (options.kind !== "order") throw new Error("Invoice order sources returned an unexpected result.");
    return { success: true as const, rows: options.rows, hasMore: options.has_more };
  } catch (error) {
    return { success: false as const, error: getErrorMessage(error, "Eligible orders are unavailable.") };
  }
}

export async function searchInvoiceEligibilityDispatchesAction(input: {
  order_id: string;
  search?: string;
  selected_id?: string | null;
}) {
  try {
    const context = await getSessionContext();
    if (!can(context.role, "read", "financials")) return { success: false as const, error: "You do not have permission to inspect invoice sources." };
    const parsed = dispatchSearchSchema.safeParse(input);
    if (!parsed.success) return { success: false as const, error: "Choose a valid order and dispatch search." };
    const options = await loadInvoiceSourceOptions(await createClient(), {
      kind: "dispatch", search: parsed.data.selected_id ? "" : parsed.data.search,
      orderId: parsed.data.order_id, invoiceId: null, selectedId: parsed.data.selected_id ?? null
    });
    if (options.kind !== "dispatch" || options.rows.some((row) => row.order_id !== parsed.data.order_id)) {
      throw new Error("Eligible dispatch sources returned an unexpected result.");
    }
    return { success: true as const, rows: options.rows, hasMore: options.has_more };
  } catch (error) {
    return { success: false as const, error: getErrorMessage(error, "Eligible dispatches are unavailable.") };
  }
}

export async function reviewInvoiceDispatchAction(input: { order_id: string; dispatch_id: string }) {
  try {
    const context = await getSessionContext();
    if (!can(context.role, "read", "financials")) return { success: false as const, error: "You do not have permission to review invoice sources." };
    const parsed = reviewDispatchSchema.safeParse(input);
    if (!parsed.success) return { success: false as const, error: "Choose a valid order and dispatch." };
    const client = await createClient();
    const dispatchOptions = await loadInvoiceSourceOptions(client, {
      kind: "dispatch", search: "", orderId: parsed.data.order_id, invoiceId: null, selectedId: parsed.data.dispatch_id
    });
    if (dispatchOptions.kind !== "dispatch" || dispatchOptions.rows.length !== 1) {
      return { success: false as const, error: "This dispatch is no longer eligible. Refresh and review the available sources." };
    }
    const dispatch = dispatchOptions.rows[0];
    const { data: order, error: orderError } = await client.from("orders")
      .select("id, order_number, customer_id, customers(customer_name, company_name)")
      .eq("company_id", context.companyId).eq("id", parsed.data.order_id).maybeSingle();
    if (orderError) throw orderError;
    if (!order || dispatch.order_id !== order.id) return { success: false as const, error: "Order and dispatch lineage could not be verified." };

    const lines: Record<string, any>[] = [];
    const identities = new Set<string>();
    let expectedCount: number | null = null;
    for (let start = 0; ; start += 200) {
      const result = await client.from("packing_list_items_authorized").select("*", { count: "exact" })
        .eq("company_id", context.companyId).eq("dispatch_id", dispatch.id).order("id", { ascending: true }).range(start, start + 199);
      if (result.error) throw result.error;
      const count = result.count;
      if (!Array.isArray(result.data) || typeof count !== "number" || !Number.isSafeInteger(count) || count < 1 || count > 5000
        || (expectedCount !== null && count !== expectedCount)
        || result.data.length !== Math.min(200, Math.max(count - start, 0))) {
        throw new Error("The complete packing manifest could not be verified. Refresh before invoicing.");
      }
      expectedCount = count;
      for (const row of result.data) {
        if (!uuid.safeParse(row?.id).success || identities.has(row.id)) throw new Error("The packing manifest contains conflicting source identities.");
        identities.add(row.id);
        lines.push(row);
      }
      if (lines.length === expectedCount) break;
    }

    const taxBasisLines = await applyInvoiceSourceTaxBasis(client, context.companyId, lines);
    const items = buildInvoiceItems(taxBasisLines, "00000000-0000-0000-0000-000000000000", context.companyId);
    if (items.some((item) => ![item.quantity, item.unit_rate, item.line_total].every((value) => Number.isFinite(Number(value)) && Number(value) > 0))) {
      return { success: false as const, error: "Every packed line needs a positive shipped weight and agreed rate before it can be invoiced." };
    }
    const settings = await client.from("company_settings").select("default_gst_percent")
      .eq("company_id", context.companyId).maybeSingle();
    if (settings.error) throw settings.error;
    const defaultGstPercent = Number(settings.data?.default_gst_percent ?? 18);
    if (!Number.isFinite(defaultGstPercent) || defaultGstPercent < 0 || defaultGstPercent > 100) {
      throw new Error("The configured GST rate could not be verified.");
    }
    const subtotal = Number(items.reduce((sum, item) => sum + Number(item.line_total), 0).toFixed(2));
    let taxTotal = 0;
    const reviewRows = items.map((item, index) => {
      if (item.gst_percent === null || item.gst_percent === undefined) {
        throw new Error("A packed line has no GST rate on its source order or quote. Correct the source before invoicing.");
      }
      const rawGstPercent = Number(item.gst_percent);
      if (!Number.isFinite(rawGstPercent) || rawGstPercent < 0 || rawGstPercent > 100) throw new Error("A packed line has an invalid GST rate.");
      const lineTotal = Number(Number(item.line_total).toFixed(2));
      const taxAmount = Math.round((lineTotal * rawGstPercent + 1e-7)) / 100;
      taxTotal += taxAmount;
      return {
        source_line_id: String(item.source_line_id),
        bundle_number: lines[index]?.bundle_number ?? null,
        profile_id: item.profile_id ? String(item.profile_id) : null,
        description: item.item_description ? String(item.item_description) : null,
        hsn_code: item.hsn_code ? String(item.hsn_code) : null,
        quantity_kg: Number(Number(item.quantity).toFixed(3)),
        rate_per_kg: Number(Number(item.unit_rate).toFixed(2)),
        line_total: lineTotal,
        gst_percent: rawGstPercent,
        tax_amount: Number(taxAmount.toFixed(2))
      };
    });
    taxTotal = Number(taxTotal.toFixed(2));
    const fingerprint = createHash("md5").update(buildInvoiceFingerprintPayload(items, defaultGstPercent)).digest("hex");
    const customerJoin = Array.isArray(order.customers) ? order.customers[0] : order.customers;
    const review = financialInvoiceReviewSchema.parse({
      order_id: order.id,
      order_number: order.order_number,
      customer_id: order.customer_id,
      customer_name: customerJoin?.company_name || customerJoin?.customer_name || null,
      dispatch_id: dispatch.id,
      dispatch_number: dispatch.dispatch_number,
      dispatch_date: dispatch.dispatch_date,
      delivery_status: dispatch.delivery_status,
      source_fingerprint: fingerprint,
      default_gst_percent: defaultGstPercent,
      subtotal,
      tax_total: taxTotal,
      grand_total: Number((subtotal + taxTotal).toFixed(2)),
      rows: reviewRows
    });
    return { success: true as const, data: review };
  } catch (error) {
    return { success: false as const, error: getErrorMessage(error, "Invoice eligibility could not be reviewed.") };
  }
}

export async function searchOpenReceivableInvoicesAction(input: { search?: string }) {
  try {
    const context = await getSessionContext();
    if (!can(context.role, "read", "financials")) return { success: false as const, error: "You do not have permission to review receivables." };
    const parsed = receivableSearchSchema.safeParse(input);
    if (!parsed.success) return { success: false as const, error: "Enter an invoice search of at most 100 characters." };
    const client = await createClient();
    let query = client.from("invoices").select(
      "id, invoice_number, invoice_date, due_date, grand_total, amount_paid, credited_amount, balance_due, status, customers(customer_name, company_name), orders(order_number)"
    ).eq("company_id", context.companyId).in("status", ["generated", "sent", "partially_paid", "overdue"])
      .gt("balance_due", 0).order("due_date", { ascending: true, nullsFirst: false }).order("invoice_number", { ascending: true }).limit(101);
    const term = parsed.data.search.replace(/[%,()*]/g, " ").trim();
    const invoicePattern = "%" + term + "%";
    if (term) query = query.ilike("invoice_number", invoicePattern);
    const result = await query;
    if (result.error) throw result.error;
    const today = new Date().toISOString().slice(0, 10);
    const one = <T,>(value: T | T[] | null | undefined) => Array.isArray(value) ? value[0] ?? null : value ?? null;
    const allRows = ((result.data ?? []) as any[]).map((row) => {
      const customer = one(row.customers) as { customer_name?: string | null; company_name?: string | null } | null;
      const order = one(row.orders) as { order_number?: string | null } | null;
      const due = row.due_date as string | null;
      const overdueDays = due && due < today && Number(row.balance_due) > 0
        ? Math.floor((Date.parse(`${today}T00:00:00.000Z`) - Date.parse(`${due}T00:00:00.000Z`)) / 86_400_000)
        : 0;
      return {
        id: row.id,
        invoice_number: row.invoice_number,
        invoice_date: row.invoice_date,
        due_date: due,
        grand_total: Number(row.grand_total),
        amount_paid: Number(row.amount_paid),
        credited_amount: Number(row.credited_amount ?? 0),
        balance_due: Number(row.balance_due),
        status: row.status,
        customer_name: customer?.company_name || customer?.customer_name || null,
        order_number: order?.order_number ?? null,
        overdue_days: overdueDays
      };
    });
    return {
      success: true as const,
      data: {
        rows: z.array(receivableInvoiceSchema).max(100).parse(allRows.slice(0, 100)),
        hasMore: allRows.length > 100
      }
    };
  } catch (error) {
    return { success: false as const, error: getErrorMessage(error, "Open receivables are unavailable.") };
  }
}

export async function postFinancialReceiptAction(input: z.input<typeof postReceiptSchema>) {
  try {
    const context = await getSessionContext();
    if (!can(context.role, "create", "financials")) return { success: false as const, error: "You do not have permission to record receipts." };
    const parsed = postReceiptSchema.safeParse(input);
    if (!parsed.success) return { success: false as const, error: parsed.error.issues[0]?.message ?? "Check receipt details." };
    if (["bank_transfer", "upi", "cheque"].includes(parsed.data.payment_method) && !parsed.data.reference_number) {
      return { success: false as const, error: "Reference number is required for bank, UPI, and cheque receipts." };
    }
    if (parsed.data.payment_method === "credit_note" && (parsed.data.notes?.trim().length ?? 0) < 5) {
      return { success: false as const, error: "Enter a clear reason for the credit adjustment." };
    }
    const uniqueInvoices = new Set(parsed.data.allocations.map((allocation) => allocation.invoice_id));
    const allocated = parsed.data.allocations.reduce((sum, allocation) => sum + allocation.amount, 0);
    if (uniqueInvoices.size !== parsed.data.allocations.length || Math.round(allocated * 100) !== Math.round(parsed.data.amount * 100)) {
      return { success: false as const, error: "Use one allocation per invoice and make allocations equal the received amount exactly." };
    }
    const client = await createClient();
    const result = await client.rpc("post_financial_receipt_atomic", {
      p_receipt: {
        amount: parsed.data.amount,
        payment_date: parsed.data.payment_date,
        payment_method: parsed.data.payment_method,
        reference_number: parsed.data.reference_number || null,
        notes: parsed.data.notes || null,
        source_type: "manual"
      },
      p_allocations: parsed.data.allocations,
      p_idempotency_key: parsed.data.idempotency_key
    });
    if (result.error) throw result.error;
    const data = receiptPostingResultSchema.parse(result.data);
    revalidatePath("/payments");
    revalidatePath("/payments/receipts");
    revalidatePath("/invoices");
    revalidatePath("/invoices/eligibility");
    revalidatePath("/analytics");
    revalidatePath("/dashboard");
    for (const allocation of data.allocations) revalidatePath(`/invoices/${allocation.invoice_id}`);
    return { success: true as const, data };
  } catch (error) {
    return { success: false as const, error: getErrorMessage(error, "Receipt could not be posted.") };
  }
}

export async function importFinancialReceiptCsvAction(input: {
  csv_text: string;
  source_name: string;
  mapping: ReceiptCsvMapping;
}) {
  try {
    const context = await getSessionContext();
    if (!can(context.role, "create", "financials")) return { success: false as const, error: "You do not have permission to import receipts." };
    const parsed = csvImportSchema.safeParse(input);
    if (!parsed.success) return { success: false as const, error: parsed.error.issues[0]?.message ?? "Check the CSV and field mapping." };
    const mapping = receiptCsvMappingSchema.parse(parsed.data.mapping);
    const preview = previewReceiptCsv(parsed.data.csv_text, mapping);
    const sourceName = parsed.data.source_name.replace(/^.*[\\/]/, "").slice(0, 160);
    const sourceFingerprint = createHash("sha256")
      .update(parsed.data.csv_text)
      .update("\0")
      .update(JSON.stringify(mapping))
      .digest("hex");
    const rows = preview.rows.map((row) => ({
      row_number: row.row_number,
      invoice_number: row.invoice_number,
      payment_date: row.payment_date,
      amount: row.amount ?? null,
      payment_method: row.payment_method ?? null,
      reference_number: row.reference_number || null,
      notes: row.notes || null,
      error: row.error || null
    }));
    const client = await createClient();
    const result = await client.rpc("import_financial_receipt_csv_atomic", {
      p_source_fingerprint: sourceFingerprint,
      p_source_name: sourceName || "receipt-import.csv",
      p_field_mapping: mapping,
      p_rows: rows
    });
    if (result.error) throw result.error;
    const data = receiptImportResultSchema.parse(result.data);
    revalidatePath("/payments");
    revalidatePath("/payments/receipts");
    revalidatePath("/invoices");
    revalidatePath("/analytics");
    revalidatePath("/dashboard");
    return { success: true as const, data };
  } catch (error) {
    return { success: false as const, error: getErrorMessage(error, "Receipt CSV could not be imported.") };
  }
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function previewFinancialCorrectionAction(input: { record_type: "invoice" | "payment"; record_id: string }) {
  try {
    const context = await getSessionContext();
    if (!can(context.role, "read", "financials")) return { success: false as const, error: "You do not have permission to review financial corrections." };
    const parsed = correctionPreviewRequestSchema.safeParse(input);
    if (!parsed.success) return { success: false as const, error: "Choose a valid invoice or payment record." };
    const client = await createClient();
    if (parsed.data.record_type === "invoice") {
      const result = await client.from("invoices")
        .select("id, invoice_number, status, invoice_date, grand_total, amount_paid, credited_amount, balance_due, source_fingerprint, issued_snapshot")
        .eq("company_id", context.companyId).eq("id", parsed.data.record_id).maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) return { success: false as const, error: "Invoice not found for this company." };
      const row = result.data as any;
      const source = {
        record_type: "invoice", id: row.id, status: row.status, invoice_date: row.invoice_date,
        grand_total: Number(row.grand_total), amount_paid: Number(row.amount_paid),
        credited_amount: Number(row.credited_amount ?? 0), balance_due: Number(row.balance_due),
        source_fingerprint: row.source_fingerprint ?? null, issued_snapshot: row.issued_snapshot ?? null
      };
      const canEditDraft = ["draft", "generated"].includes(row.status) && Number(row.amount_paid) === 0 && !row.issued_snapshot;
      const canCredit = ["generated", "sent", "partially_paid", "overdue"].includes(row.status) && Number(row.balance_due) > 0;
      return {
        success: true as const,
        data: correctionPreviewSchema.parse({
          record_type: "invoice", record_id: row.id, fingerprint: fingerprint(source), state: row.status,
          summary: `${row.invoice_number || "Invoice"}: INR ${Number(row.balance_due).toFixed(2)} remains outstanding.`,
          route: canEditDraft ? "edit_draft" : canCredit ? "credit_adjustment" : "unavailable",
          edit_url: canEditDraft ? `/invoices/${row.id}/edit` : null,
          adjustment_limit: canCredit ? Number(row.balance_due) : null
        })
      };
    }

    const result = await client.from("payments")
      .select("id, invoice_id, amount, payment_method, payment_type, payment_status, payment_date, reference_number, receipt_event_id, reversal_idempotency_key, reversal_reason")
      .eq("company_id", context.companyId).eq("id", parsed.data.record_id).maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) return { success: false as const, error: "Payment not found for this company." };
    const row = result.data as any;
    const source = {
      record_type: "payment", id: row.id, invoice_id: row.invoice_id, amount: Number(row.amount),
      payment_method: row.payment_method, payment_type: row.payment_type, payment_status: row.payment_status,
      payment_date: row.payment_date, reference_number: row.reference_number, receipt_event_id: row.receipt_event_id
    };
    return {
      success: true as const,
      data: correctionPreviewSchema.parse({
        record_type: "payment", record_id: row.id,
        fingerprint: fingerprint(source), state: row.payment_status,
        summary: `${row.payment_method === "credit_note" ? "Credit adjustment" : "Receipt"} of INR ${Number(row.amount).toFixed(2)} on ${row.payment_date}.`,
        route: row.payment_status === "PAID" ? "reverse_receipt" : "unavailable",
        edit_url: null, adjustment_limit: null
      })
    };
  } catch (error) {
    return { success: false as const, error: getErrorMessage(error, "Correction preview is unavailable.") };
  }
}

export async function applyFinancialCorrectionAction(input: z.input<typeof correctionApplyInputSchema>) {
  try {
    const context = await getSessionContext();
    if (!can(context.role, "update", "financials") && !can(context.role, "create", "financials")) {
      return { success: false as const, error: "You do not have permission to apply financial corrections." };
    }
    const parsed = correctionApplyInputSchema.safeParse(input);
    if (!parsed.success) return { success: false as const, error: parsed.error.issues[0]?.message ?? "Check correction details." };
    const client = await createClient();

    if (parsed.data.record_type === "payment") {
      const result = await client.from("payments")
        .select("id, invoice_id, amount, payment_method, payment_type, payment_status, payment_date, reference_number, receipt_event_id, reversal_idempotency_key")
        .eq("company_id", context.companyId).eq("id", parsed.data.record_id).maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) return { success: false as const, error: "Payment not found for this company." };
      const row = result.data as any;
      const source = {
        record_type: "payment", id: row.id, invoice_id: row.invoice_id, amount: Number(row.amount),
        payment_method: row.payment_method, payment_type: row.payment_type, payment_status: row.payment_status,
        payment_date: row.payment_date, reference_number: row.reference_number, receipt_event_id: row.receipt_event_id
      };
      if (row.reversal_idempotency_key === parsed.data.idempotency_key && row.payment_status === "CANCELLED") {
        const retry = await client.rpc("reverse_payment_atomic", {
          p_payment_id: row.id, p_reason: parsed.data.reason, p_idempotency_key: parsed.data.idempotency_key
        });
        if (retry.error) throw retry.error;
        revalidatePath("/payments");
        revalidatePath("/payments/receipts");
        revalidatePath(`/payments/${row.id}`);
        revalidatePath(`/invoices/${row.invoice_id}`);
        revalidatePath("/analytics");
        return { success: true as const, data: retry.data, idempotent_replay: true as const };
      }
      if (fingerprint(source) !== parsed.data.fingerprint) return { success: false as const, error: "This payment changed after preview. Refresh its correction preview." };
      if (row.payment_status !== "PAID") return { success: false as const, error: "Only a posted receipt or adjustment can be reversed." };
      const reversal = await client.rpc("reverse_payment_atomic", {
        p_payment_id: row.id, p_reason: parsed.data.reason, p_idempotency_key: parsed.data.idempotency_key
      });
      if (reversal.error) throw reversal.error;
      revalidatePath("/payments");
      revalidatePath("/payments/receipts");
      revalidatePath(`/payments/${row.id}`);
      revalidatePath(`/invoices/${row.invoice_id}`);
      revalidatePath("/analytics");
      return { success: true as const, data: reversal.data, idempotent_replay: false as const };
    }

    const result = await client.from("invoices")
      .select("id, invoice_number, status, invoice_date, grand_total, amount_paid, credited_amount, balance_due, source_fingerprint, issued_snapshot")
      .eq("company_id", context.companyId).eq("id", parsed.data.record_id).maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) return { success: false as const, error: "Invoice not found for this company." };
    const row = result.data as any;
    const source = {
      record_type: "invoice", id: row.id, status: row.status, invoice_date: row.invoice_date,
      grand_total: Number(row.grand_total), amount_paid: Number(row.amount_paid),
      credited_amount: Number(row.credited_amount ?? 0), balance_due: Number(row.balance_due),
      source_fingerprint: row.source_fingerprint ?? null, issued_snapshot: row.issued_snapshot ?? null
    };
    const existing = await client.from("payments").select("id, invoice_id, amount, payment_method, payment_status, payment_date, notes, idempotency_key")
      .eq("company_id", context.companyId).eq("idempotency_key", parsed.data.idempotency_key).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) {
      if (existing.data.invoice_id !== row.id || existing.data.payment_method !== "credit_note"
        || Number(existing.data.amount) !== parsed.data.amount || existing.data.notes !== parsed.data.reason) {
        return { success: false as const, error: "Correction retry identity was already used for a different financial action." };
      }
      const retry = await client.rpc("record_payment_atomic", {
        p_invoice_id: row.id,
        p_payment: { payment_date: existing.data.payment_date, amount: parsed.data.amount, payment_method: "credit_note",
          reference_number: null, notes: parsed.data.reason, idempotency_key: parsed.data.idempotency_key }
      });
      if (retry.error) throw retry.error;
      revalidatePath("/payments");
      revalidatePath(`/invoices/${row.id}`);
      return { success: true as const, data: retry.data, idempotent_replay: true as const };
    }
    if (fingerprint(source) !== parsed.data.fingerprint) return { success: false as const, error: "This invoice changed after preview. Refresh its correction preview." };
    if (!["generated", "sent", "partially_paid", "overdue"].includes(row.status) || Number(row.balance_due) <= 0) {
      return { success: false as const, error: "This invoice has no open receivable for a credit adjustment." };
    }
    if (!parsed.data.amount || parsed.data.amount > Number(row.balance_due)) {
      return { success: false as const, error: "Credit adjustment must be positive and cannot exceed the current open balance." };
    }
    const adjustment = await client.rpc("record_payment_atomic", {
      p_invoice_id: row.id,
      p_payment: { payment_date: new Date().toISOString().slice(0, 10), amount: parsed.data.amount,
        payment_method: "credit_note", reference_number: null, notes: parsed.data.reason,
        idempotency_key: parsed.data.idempotency_key }
    });
    if (adjustment.error) throw adjustment.error;
    revalidatePath("/payments");
    revalidatePath("/payments/receipts");
    revalidatePath(`/invoices/${row.id}`);
    revalidatePath("/analytics");
    return { success: true as const, data: adjustment.data, idempotent_replay: false as const };
  } catch (error) {
    return { success: false as const, error: getErrorMessage(error, "Financial correction could not be applied.") };
  }
}
