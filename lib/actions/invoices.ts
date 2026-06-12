"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { buildInvoiceItems } from "@/lib/pcda/invoice";
import { createClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils/errors";
import { nextBusinessNumber } from "@/lib/utils/numbering";
import { invoiceSchema } from "@/lib/validations/schemas";

type SaveInvoiceInput = z.input<typeof invoiceSchema> & { editing_id?: string | null };
type InvoiceActionResult = { success: true; invoiceId?: string } | { success: false; error: string };

function revalidateInvoicePaths(invoiceId?: string) {
  revalidatePath("/invoices");
  revalidatePath("/invoices/database");
  revalidatePath("/payments");
  if (invoiceId) revalidatePath(`/invoices/${invoiceId}`);
}

/**
 * Load PCDA source lines for invoice items.
 * Priority: packing_list_items from dispatch → order_items → quote_items.
 */
async function loadInvoiceSourceLines(supabase: any, companyId: string, orderId: string | null, dispatchId: string | null) {
  // 1. Try packing_list_items from specific dispatch
  if (dispatchId) {
    const packingResult = await supabase
      .from("packing_list_items")
      .select("*")
      .eq("company_id", companyId)
      .eq("dispatch_id", dispatchId)
      .order("created_at", { ascending: true });
    if (!packingResult.error && (packingResult.data ?? []).length > 0) {
      return packingResult.data;
    }
  }

  // 2. Try order_items
  if (orderId) {
    const orderItemsResult = await supabase
      .from("order_items")
      .select("*")
      .eq("company_id", companyId)
      .eq("order_id", orderId)
      .order("created_at", { ascending: true });
    if (!orderItemsResult.error && (orderItemsResult.data ?? []).length > 0) {
      return orderItemsResult.data;
    }
  }

  return [];
}

export async function saveInvoiceAction(input: SaveInvoiceInput): Promise<InvoiceActionResult> {
  try {
    const context = await getSessionContext();
    const editingId = input.editing_id || null;
    if (!can(context.role, editingId ? "update" : "create", "financials")) {
      return { success: false, error: "You do not have permission to manage invoices." };
    }

    const parsed = invoiceSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Please check invoice details." };

    const supabase = await createClient();

    // Validate customer belongs to company
    const { data: customer, error: custError } = await supabase
      .from("customers")
      .select("id")
      .eq("company_id", context.companyId)
      .eq("id", parsed.data.customer_id)
      .maybeSingle();
    if (custError) throw custError;
    if (!customer) return { success: false, error: "Customer not found for this company." };

    // Generate invoice number for new invoices
    let invoiceNumber = parsed.data.invoice_number;
    if (!editingId && !invoiceNumber) {
      const { data: existingNumbers } = await supabase
        .from("invoices")
        .select("invoice_number")
        .eq("company_id", context.companyId);
      invoiceNumber = nextBusinessNumber("INV", (existingNumbers ?? []).map((inv: any) => inv.invoice_number).filter(Boolean));
    }

    const payload = {
      ...parsed.data,
      invoice_number: invoiceNumber || parsed.data.invoice_number || null,
      order_id: parsed.data.order_id || null,
      dispatch_id: parsed.data.dispatch_id || null,
      notes: parsed.data.notes || null,
      company_id: context.companyId,
      created_by: context.userId
    };

    const result = editingId
      ? await supabase.from("invoices").update(payload).eq("id", editingId).eq("company_id", context.companyId).select("id").single()
      : await supabase.from("invoices").insert(payload).select("id").single();

    if (result.error || !result.data) throw result.error ?? new Error("Could not save invoice");
    const invoiceId = result.data.id;

    // Generate invoice_items from PCDA source lines (only on creation or re-generation)
    if (!editingId) {
      const sourceLines = await loadInvoiceSourceLines(
        supabase,
        context.companyId,
        parsed.data.order_id || null,
        parsed.data.dispatch_id || null
      );

      if (sourceLines.length) {
        const invoiceItems = buildInvoiceItems(sourceLines, invoiceId, context.companyId);
        const insertResult = await supabase.from("invoice_items").insert(invoiceItems);
        if (insertResult.error) throw insertResult.error;
      }
    }

    revalidateInvoicePaths(invoiceId);
    return { success: true, invoiceId };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not save invoice") };
  }
}

/**
 * Regenerate invoice items from source PCDA lines.
 * Useful when dispatch weights/quantities are updated after initial invoice creation.
 */
export async function regenerateInvoiceItemsAction(invoiceId: string): Promise<InvoiceActionResult> {
  try {
    const context = await getSessionContext();
    if (!can(context.role, "update", "financials")) {
      return { success: false, error: "You do not have permission to manage invoices." };
    }

    const supabase = await createClient();
    const { data: invoice, error: invError } = await supabase
      .from("invoices")
      .select("id, order_id, dispatch_id, status")
      .eq("id", invoiceId)
      .eq("company_id", context.companyId)
      .maybeSingle();

    if (invError) throw invError;
    if (!invoice) return { success: false, error: "Invoice not found." };
    if (["paid", "cancelled"].includes(invoice.status)) {
      return { success: false, error: "Cannot regenerate items for paid or cancelled invoices." };
    }

    // Delete existing items and regenerate
    await supabase.from("invoice_items").delete().eq("invoice_id", invoiceId).eq("company_id", context.companyId);

    const sourceLines = await loadInvoiceSourceLines(supabase, context.companyId, invoice.order_id, invoice.dispatch_id);
    if (sourceLines.length) {
      const invoiceItems = buildInvoiceItems(sourceLines, invoiceId, context.companyId);
      const insertResult = await supabase.from("invoice_items").insert(invoiceItems);
      if (insertResult.error) throw insertResult.error;
    }

    revalidateInvoicePaths(invoiceId);
    return { success: true, invoiceId };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not regenerate invoice items") };
  }
}
