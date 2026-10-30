"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { buildInvoiceItems } from "@/lib/pcda/invoice";
import { isGstStateCode } from "@/lib/calculations/gst";
import { createClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils/errors";
import {applyInvoiceSourceTaxBasis,canInvoiceOrderDispatch,invoiceSourceRequest,loadInvoiceSourceOptions,type InvoiceSourceRequest,type InvoiceSourceOptions} from "@/lib/financials/invoice-sources";
import { buildInvoiceFingerprintPayload } from "@/lib/workflow/financial-workflow-review";

const saveInvoiceInputSchema = z.object({
  place_of_supply_state_code: z.string().refine(isGstStateCode, "Select a supported domestic place of supply"),
  editing_id: z.string().uuid().optional().nullable(),
  order_id: z.string().uuid("Select a source order"),
  dispatch_id: z.string().uuid("Select the packed dispatch to invoice"),
  invoice_number: z.string().trim().max(80).optional().nullable(),
  invoice_date: z.string().min(1, "Invoice date is required"),
  due_date: z.string().optional().nullable(),
  status: z.enum(["draft", "generated", "sent"]).default("draft"),
  source_fingerprint: z.string().regex(/^[0-9a-f]{32}$/).optional().nullable(),
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

export async function searchInvoiceSourcesAction(input: InvoiceSourceRequest): Promise<
  {success:true;options:InvoiceSourceOptions} | {success:false;error:string}
> {
  try {
    const context = await getSessionContext();
    if(!can(context.role,"read","financials")) return {success:false,error:"You do not have permission to inspect invoice sources."};
    const parsed = invoiceSourceRequest.safeParse(input);
    if(!parsed.success) return {success:false,error:"Check the invoice source and enter a search of at most 100 characters."};
    return {success:true,options:await loadInvoiceSourceOptions(await createClient(),parsed.data)};
  } catch {return {success:false,error:"Invoice sources are unavailable. Refresh before choosing a source."};}
}

async function loadInvoiceSourceLines(supabase: any,companyId: string,dispatchId: string) {
  const rows: Record<string,any>[] = [];
  const identities = new Set<string>();
  let expected: number | null = null;
  for(let start=0;;start+=200) {
    const result = await supabase.from("packing_list_items_authorized").select("*",{count:"exact"})
      .eq("company_id",companyId).eq("dispatch_id",dispatchId).order("id",{ascending:true}).range(start,start+199);
    if(result.error) throw result.error;
    if(!Array.isArray(result.data) || !Number.isSafeInteger(result.count) || result.count < 0 || result.count > 100000
      || (expected !== null && result.count !== expected)) throw new Error("The complete packing list could not be verified. Refresh before invoicing.");
    const count: number = result.count;
    expected = count;
    if(result.data.length !== Math.min(200,Math.max(count-start,0))) throw new Error("The packing list is incomplete. Refresh before invoicing.");
    for(const row of result.data) {
      if(!z.string().uuid().safeParse(row?.id).success || identities.has(row.id)) throw new Error("The packing list contains conflicting source identities.");
      identities.add(row.id);rows.push(row);
    }
    if(rows.length === expected) return applyInvoiceSourceTaxBasis(supabase, companyId, rows);
  }
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

    const dispatchId = parsed.data.dispatch_id;
    const { data: dispatch, error: dispatchError } = await supabase
      .from("dispatches")
      .select("id, order_id, delivery_status")
      .eq("company_id", context.companyId)
      .eq("id", dispatchId)
      .maybeSingle();
    if (dispatchError) throw dispatchError;
    if (!dispatch || dispatch.order_id !== parsed.data.order_id) {
      return { success: false, error: "Selected dispatch does not belong to the source order." };
    }
    if (["returned", "damaged"].includes(dispatch.delivery_status)) {
      return {
        success: false,
        error: "Returned or damaged dispatches cannot be invoiced. Resolve the return or damage and create a replacement dispatch first."
      };
    }
    if (!canInvoiceOrderDispatch(order.current_stage,dispatch.delivery_status)) {
      return {success:false,error:"Only a retained dispatched, in-transit or delivered shipment can be invoiced after cancellation. Unfulfilled quantities cannot be invoiced."};
    }

    const sourceLines = await loadInvoiceSourceLines(
      supabase,
      context.companyId,
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
    if (parsed.data.source_fingerprint) {
      const settings = await supabase.from("company_settings").select("default_gst_percent")
        .eq("company_id", context.companyId).maybeSingle();
      if (settings.error) throw settings.error;
      const defaultGst = Number(settings.data?.default_gst_percent ?? 18);
      if (!Number.isFinite(defaultGst) || defaultGst < 0 || defaultGst > 100) {
        throw new Error("The configured GST rate could not be verified. Refresh the invoice review.");
      }
      const currentFingerprint = createHash("md5")
        .update(buildInvoiceFingerprintPayload(invoiceItems, defaultGst))
        .digest("hex");
      if (currentFingerprint !== parsed.data.source_fingerprint) {
        return { success: false, error: "The packing manifest or tax basis changed after review. Return to invoice eligibility and review it again." };
      }
    }
    const invoiceWriter = parsed.data.source_fingerprint ? "save_reviewed_invoice_atomic" : "save_invoice_atomic";
    const result = await supabase.rpc(invoiceWriter, {
      p_invoice_id: editingId,
      p_invoice: {
        customer_id: order.customer_id,
        place_of_supply_state_code: parsed.data.place_of_supply_state_code,
        order_id: parsed.data.order_id,
        dispatch_id: dispatchId,
        invoice_number: parsed.data.invoice_number || null,
        invoice_date: parsed.data.invoice_date,
        due_date: parsed.data.due_date || null,
        status: parsed.data.status,
        ...(parsed.data.source_fingerprint ? { source_fingerprint: parsed.data.source_fingerprint } : {}),
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
