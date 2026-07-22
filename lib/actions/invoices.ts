"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { buildInvoiceItems } from "@/lib/pcda/invoice";
import { createClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils/errors";

const saveInvoiceInputSchema = z.object({
  editing_id: z.string().uuid().optional().nullable(),
  order_id: z.string().uuid("Select a source order"),
  dispatch_id: z.string().uuid("Select the packed dispatch to invoice"),
  invoice_number: z.string().trim().max(80).optional().nullable(),
  invoice_date: z.string().min(1, "Invoice date is required"),
  due_date: z.string().optional().nullable(),
  status: z.enum(["draft", "generated", "sent"]).default("draft"),
  notes: z.string().trim().max(2000).optional().nullable()
});

export type SaveInvoiceInput = z.input<typeof saveInvoiceInputSchema>;
type InvoiceActionResult = { success: true; invoiceId?: string } | { success: false; error: string };
function invoiceItemsAreBillable(items: Record<string, any>[]): boolean {
  return items.every((item) =>
    [item.quantity, item.unit_rate, item.line_total].every((value) => {
      const amount = Number(value);
      return Number.isFinite(amount) && amount > 0;
    })
  );
}


function revalidateInvoicePaths(invoiceId?: string) {
  revalidatePath("/invoices");
  revalidatePath("/invoices/database");
  revalidatePath("/payments");
  revalidatePath("/analytics");
  if (invoiceId) revalidatePath(`/invoices/${invoiceId}`);
}

async function loadInvoiceSourceLines(
  supabase: any,
  companyId: string,
  orderId: string,
  dispatchId: string | null
) {
  if (dispatchId) {
    const packingResult = await supabase
      .from("packing_list_items")
      .select("*")
      .eq("company_id", companyId)
      .eq("dispatch_id", dispatchId)
      .order("created_at", { ascending: true });
    if (packingResult.error) throw packingResult.error;
    return packingResult.data ?? [];
  }

  const orderItemsResult = await supabase
    .from("order_items")
    .select("*")
    .eq("company_id", companyId)
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });
  if (orderItemsResult.error) throw orderItemsResult.error;
  return orderItemsResult.data ?? [];
}

export async function saveInvoiceAction(input: SaveInvoiceInput): Promise<InvoiceActionResult> {
  try {
    const context = await getSessionContext();
    const parsed = saveInvoiceInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Please check invoice details." };
    }

    const editingId = parsed.data.editing_id || null;
    if (!can(context.role, editingId ? "update" : "create", "financials")) {
      return { success: false, error: "You do not have permission to manage invoices." };
    }

    const supabase = await createClient();
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, customer_id, current_stage")
      .eq("company_id", context.companyId)
      .eq("id", parsed.data.order_id)
      .maybeSingle();
    if (orderError) throw orderError;
    if (!order) return { success: false, error: "Source order not found for this company." };
    if (order.current_stage === "cancelled") return { success: false, error: "A cancelled order cannot be invoiced." };

    const dispatchId = parsed.data.dispatch_id;
    const { data: dispatch, error: dispatchError } = await supabase
      .from("dispatches")
      .select("id, order_id")
      .eq("company_id", context.companyId)
      .eq("id", dispatchId)
      .maybeSingle();
    if (dispatchError) throw dispatchError;
    if (!dispatch || dispatch.order_id !== parsed.data.order_id) {
      return { success: false, error: "Selected dispatch does not belong to the source order." };
    }

    const sourceLines = await loadInvoiceSourceLines(
      supabase,
      context.companyId,
      parsed.data.order_id,
      dispatchId
    );
    if (sourceLines.length === 0) {
      return {
        success: false,
        error: "This dispatch has no packing lines to invoice. Complete its packing list first."
      };
    }

    const invoiceItems = buildInvoiceItems(
      sourceLines,
      editingId ?? "00000000-0000-0000-0000-000000000000",
      context.companyId
    );
    if (!invoiceItemsAreBillable(invoiceItems)) {
      return { success: false, error: "Every packed line needs a positive shipped weight and commercial rate before invoicing." };
    }
    const result = await supabase.rpc("save_invoice_atomic", {
      p_invoice_id: editingId,
      p_invoice: {
        customer_id: order.customer_id,
        order_id: parsed.data.order_id,
        dispatch_id: dispatchId,
        invoice_number: parsed.data.invoice_number || null,
        invoice_date: parsed.data.invoice_date,
        due_date: parsed.data.due_date || null,
        status: parsed.data.status,
        notes: parsed.data.notes || null
      },
      p_items: invoiceItems,
      p_replace_items: true
    });
    if (result.error || !result.data) throw result.error ?? new Error("Could not save invoice");
    const invoiceId = String(result.data);

    revalidateInvoicePaths(invoiceId);
    return { success: true, invoiceId };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not save invoice") };
  }
}

export async function regenerateInvoiceItemsAction(invoiceId: string): Promise<InvoiceActionResult> {
  try {
    const context = await getSessionContext();
    if (!can(context.role, "update", "financials")) {
      return { success: false, error: "You do not have permission to manage invoices." };
    }

    const supabase = await createClient();
    const { data: invoice, error: invoiceError } = await supabase
      .from("invoices")
      .select("id, order_id, dispatch_id, status, amount_paid")
      .eq("id", invoiceId)
      .eq("company_id", context.companyId)
      .maybeSingle();
    if (invoiceError) throw invoiceError;
    if (!invoice) return { success: false, error: "Invoice not found." };
    if (!invoice.order_id) return { success: false, error: "Invoice has no source order." };
    if (!invoice.dispatch_id) return { success: false, error: "Legacy full-order invoices cannot regenerate lines. Create a dispatch-backed invoice instead." };
    if (!["draft", "generated"].includes(invoice.status) || Number(invoice.amount_paid ?? 0) > 0) {
      return { success: false, error: "Only unpaid draft or generated invoices can regenerate source lines." };
    }

    const sourceLines = await loadInvoiceSourceLines(
      supabase,
      context.companyId,
      invoice.order_id,
      invoice.dispatch_id
    );
    if (sourceLines.length === 0) return { success: false, error: "The invoice source has no billable lines." };

    const invoiceItems = buildInvoiceItems(sourceLines, invoiceId, context.companyId);
    if (!invoiceItemsAreBillable(invoiceItems)) {
      return { success: false, error: "Every packed line needs a positive shipped weight and commercial rate before invoicing." };
    }
    const replaceResult = await supabase.rpc("replace_invoice_items_atomic", {
      p_invoice_id: invoiceId,
      p_items: invoiceItems
    });
    if (replaceResult.error) throw replaceResult.error;

    revalidateInvoicePaths(invoiceId);
    return { success: true, invoiceId };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not regenerate invoice items") };
  }
}
