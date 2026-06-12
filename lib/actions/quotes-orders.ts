"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { calculateQuoteItem, calculateQuoteSummary } from "@/lib/calculations/quote";
import { buildOrderItemFromQuoteItem, buildQuoteItemPcdaFields, hasUnapprovedDrawing } from "@/lib/pcda/quote-order";
import { createClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils/errors";
import { nextBusinessNumber } from "@/lib/utils/numbering";
import { todayIso } from "@/lib/utils/format";
import { orderSchema, quoteSchema } from "@/lib/validations/schemas";
import type { OrderStage, QuoteStatus } from "@/types/app";

const quoteStatusSchema = z.enum(["draft", "internal_review", "approved_for_sending", "sent", "customer_approved", "customer_rejected", "expired", "converted_to_order"]);
const revisionLockedStatuses = ["sent", "customer_approved", "customer_rejected", "expired", "converted_to_order"];
const restrictedApprovalStatuses = ["approved_for_sending", "sent", "customer_approved", "converted_to_order"];
const lowMarginApprovalRoles = ["owner", "admin", "sales_manager"];
const profileSelect = "id, profile_code, profile_name, section_weight_kg_per_m, section_number, section_code, section_name, drawing_document_id, drawing_revision, drawing_approval_status, alloy_standard_id, alloy_id, temper_id, min_weight, max_weight, weight_tolerance, actual_weight_kg_per_m, standard_length, bundle_quantity, pieces_per_bundle, meter_per_bundle, kg_per_bundle";

type SaveQuoteInput = z.input<typeof quoteSchema> & { editing_id?: string | null };
type SaveOrderInput = z.input<typeof orderSchema> & { editing_id?: string | null };
type ActionResult = { success: true; quoteId?: string; orderId?: string } | { success: false; error: string };

function isLowMarginApprover(role: string) {
  return lowMarginApprovalRoles.includes(role);
}

function revalidateQuoteOrderPaths(quoteId?: string, orderId?: string) {
  revalidatePath("/quotes");
  revalidatePath("/quotes/database");
  revalidatePath("/orders");
  revalidatePath("/orders/database");
  if (quoteId) revalidatePath(`/quotes/${quoteId}`);
  if (orderId) revalidatePath(`/orders/${orderId}`);
}

function revalidateOrderPaths(orderId?: string) {
  revalidatePath("/orders");
  revalidatePath("/orders/database");
  if (orderId) revalidatePath(`/orders/${orderId}`);
}

export async function saveQuoteAction(input: SaveQuoteInput): Promise<ActionResult> {
  try {
    const context = await getSessionContext();
    const editingId = input.editing_id || null;
    if (!can(context.role, editingId ? "update" : "create", "quotes")) return { success: false, error: "You do not have permission to save quotations." };

    const parsed = quoteSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Please check quote details." };

    const supabase = await createClient();
    const canApproveLowMargin = isLowMarginApprover(context.role);
    const calculatedItems = parsed.data.items.map((item) => calculateQuoteItem(item));
    const summary = calculateQuoteSummary(calculatedItems, parsed.data.gst_percent);
    if (summary.low_margin_approval_required && restrictedApprovalStatuses.includes(parsed.data.status) && !canApproveLowMargin) {
      return { success: false, error: "This quote is below the company minimum margin and needs owner/admin approval." };
    }

    const customerResult = await supabase
      .from("customers")
      .select("id")
      .eq("company_id", context.companyId)
      .eq("id", parsed.data.customer_id)
      .maybeSingle();
    if (customerResult.error) throw customerResult.error;
    if (!customerResult.data) return { success: false, error: "Selected customer is not available for this company." };

    const profileIds = [...new Set(parsed.data.items.map((item) => item.profile_id))];
    const dieIds = [...new Set(parsed.data.items.map((item) => item.die_id).filter(Boolean) as string[])];
    const [profilesResult, diesResult, currentQuoteResult] = await Promise.all([
      supabase.from("aluminium_profiles").select(profileSelect).eq("company_id", context.companyId).in("id", profileIds),
      dieIds.length ? supabase.from("dies").select("id, profile_id").eq("company_id", context.companyId).in("id", dieIds) : Promise.resolve({ data: [], error: null }),
      editingId ? supabase.from("quotes").select("*").eq("company_id", context.companyId).eq("id", editingId).maybeSingle() : Promise.resolve({ data: null, error: null })
    ]);
    if (profilesResult.error) throw profilesResult.error;
    if (diesResult.error) throw diesResult.error;
    if (currentQuoteResult.error) throw currentQuoteResult.error;
    if (editingId && !currentQuoteResult.data) return { success: false, error: "Quote not found for this company." };

    const profilesById = new Map((profilesResult.data ?? []).map((profile: any) => [profile.id, profile]));
    const diesById = new Map((diesResult.data ?? []).map((die: any) => [die.id, die]));
    const invalidItem = parsed.data.items.find((item) => {
      const profile = profilesById.get(item.profile_id);
      const die = item.die_id ? diesById.get(item.die_id) : null;
      return !profile || (item.die_id && (!die || die.profile_id !== item.profile_id));
    });
    if (invalidItem) return { success: false, error: "One quote item has a stale profile or die selection. Refresh and select it again." };

    const currentQuote = currentQuoteResult.data;
    const existingNumbers = editingId ? null : await supabase.from("quotes").select("quote_number").eq("company_id", context.companyId);
    if (existingNumbers?.error) throw existingNumbers.error;
    const quoteNumber = editingId ? currentQuote?.quote_number : nextBusinessNumber("Q", (existingNumbers?.data ?? []).map((quote: any) => quote.quote_number));
    if (!quoteNumber) return { success: false, error: "Could not identify the quotation number. Refresh and try again." };

    const needsRevision = Boolean(editingId && currentQuote && revisionLockedStatuses.includes(currentQuote.status));
    const nextRevisionNumber = needsRevision ? Number(currentQuote?.revision_number ?? 1) + 1 : Number(currentQuote?.revision_number ?? 1);
    const nowIso = new Date().toISOString();
    const quotePayload = {
      company_id: context.companyId,
      dealer_id: context.dealerId ?? currentQuote?.dealer_id ?? null,
      quote_number: quoteNumber,
      customer_id: parsed.data.customer_id,
      quote_date: parsed.data.quote_date,
      valid_until: parsed.data.valid_until || null,
      status: parsed.data.status,
      subtotal: summary.subtotal,
      total_margin_amount: summary.total_margin_amount,
      total_before_gst: summary.total_before_gst,
      gst_percent: summary.gst_percent,
      gst_amount: summary.gst_amount,
      grand_total: summary.grand_total,
      low_margin_approval_required: summary.low_margin_approval_required,
      estimated_profit_amount: summary.estimated_profit_amount,
      estimated_profit_percent: summary.estimated_profit_percent,
      terms_and_conditions: parsed.data.terms_and_conditions || null,
      delivery_timeline: parsed.data.delivery_timeline || null,
      payment_terms: parsed.data.payment_terms || null,
      approval_notes: parsed.data.approval_notes || null,
      approved_by: parsed.data.status === "approved_for_sending" && canApproveLowMargin ? context.userId : currentQuote?.approved_by ?? null,
      approved_at: parsed.data.status === "approved_for_sending" && canApproveLowMargin ? nowIso : currentQuote?.approved_at ?? null,
      sent_at: parsed.data.status === "sent" ? nowIso : currentQuote?.sent_at ?? null,
      customer_decision_at: ["customer_approved", "customer_rejected"].includes(parsed.data.status) ? nowIso : currentQuote?.customer_decision_at ?? null,
      revision_number: nextRevisionNumber,
      notes: parsed.data.notes || null,
      created_by: context.userId
    };

    if (editingId && currentQuote && needsRevision) {
      const existingItems = await supabase.from("quote_items").select("*").eq("quote_id", editingId).eq("company_id", context.companyId).order("created_at");
      if (existingItems.error) throw existingItems.error;
      const revisionResult = await supabase.from("quote_revisions").insert({
        company_id: context.companyId,
        quote_id: editingId,
        revision_number: Number(currentQuote.revision_number ?? 1),
        snapshot_json: { quote: currentQuote, items: existingItems.data ?? [] },
        revised_by: context.userId,
        reason: parsed.data.approval_notes || "Commercial revision"
      });
      if (revisionResult.error) throw revisionResult.error;
    }

    const quoteResult = editingId
      ? await supabase.from("quotes").update(quotePayload).eq("id", editingId).eq("company_id", context.companyId).select("id").single()
      : await supabase.from("quotes").insert(quotePayload).select("id").single();
    if (quoteResult.error || !quoteResult.data) throw quoteResult.error ?? new Error("Could not save quote");

    const quoteId = quoteResult.data.id;
    if (editingId) {
      const deleteResult = await supabase.from("quote_items").delete().eq("quote_id", quoteId).eq("company_id", context.companyId);
      if (deleteResult.error) throw deleteResult.error;
    }

    const itemPayload = parsed.data.items.map((item, index) => {
      const profile = profilesById.get(item.profile_id);
      if (!profile) throw new Error("Selected profile is not available for this company.");
      const calculatedItem = calculatedItems[index];
      return {
        ...calculatedItem,
        ...buildQuoteItemPcdaFields({
          companyId: context.companyId,
          profile,
          item: { ...calculatedItem, item_description: item.item_description || null },
          gstPercent: parsed.data.gst_percent,
          quoteRevisionNumber: nextRevisionNumber
        }),
        company_id: context.companyId,
        quote_id: quoteId,
        profile_id: item.profile_id,
        die_id: item.die_id || null,
        item_description: item.item_description || null,
        finishing_type: item.finishing_type
      };
    });
    const itemResult = await supabase.from("quote_items").insert(itemPayload);
    if (itemResult.error) throw itemResult.error;

    revalidateQuoteOrderPaths(quoteId);
    return { success: true, quoteId };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not save quote") };
  }
}

export async function updateQuoteStatusAction(quoteId: string, status: QuoteStatus): Promise<ActionResult> {
  try {
    const context = await getSessionContext();
    if (!can(context.role, "update", "quotes")) return { success: false, error: "You do not have permission to update quotations." };
    const parsedStatus = quoteStatusSchema.safeParse(status);
    if (!parsedStatus.success || parsedStatus.data === "converted_to_order") return { success: false, error: "Invalid quote status." };

    const supabase = await createClient();
    const quoteResult = await supabase
      .from("quotes")
      .select("id, low_margin_approval_required")
      .eq("id", quoteId)
      .eq("company_id", context.companyId)
      .maybeSingle();
    if (quoteResult.error) throw quoteResult.error;
    if (!quoteResult.data) return { success: false, error: "Quote not found for this company." };
    if (quoteResult.data.low_margin_approval_required && ["approved_for_sending", "sent", "customer_approved"].includes(parsedStatus.data) && !isLowMarginApprover(context.role)) {
      return { success: false, error: "This low-margin quote needs owner/admin approval." };
    }

    const nowIso = new Date().toISOString();
    const metadata = {
      ...(parsedStatus.data === "approved_for_sending" && isLowMarginApprover(context.role) ? { approved_by: context.userId, approved_at: nowIso } : {}),
      ...(parsedStatus.data === "sent" ? { sent_at: nowIso } : {}),
      ...(["customer_approved", "customer_rejected"].includes(parsedStatus.data) ? { customer_decision_at: nowIso } : {})
    };
    const updateResult = await supabase.from("quotes").update({ status: parsedStatus.data, ...metadata }).eq("id", quoteId).eq("company_id", context.companyId);
    if (updateResult.error) throw updateResult.error;

    revalidateQuoteOrderPaths(quoteId);
    return { success: true, quoteId };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not update quote status") };
  }
}

export async function convertQuoteToOrderAction(quoteId: string): Promise<ActionResult> {
  try {
    const context = await getSessionContext();
    if (!can(context.role, "update", "quotes") || !can(context.role, "create", "orders")) return { success: false, error: "You do not have permission to convert quotes to orders." };

    const supabase = await createClient();
    const quoteResult = await supabase
      .from("quotes")
      .select("*")
      .eq("id", quoteId)
      .eq("company_id", context.companyId)
      .maybeSingle();
    if (quoteResult.error) throw quoteResult.error;
    const quote = quoteResult.data;
    if (!quote) return { success: false, error: "Quote not found for this company." };
    if (quote.status === "converted_to_order") return { success: false, error: "This quote has already been converted to an order." };
    if (!["customer_approved", "approved_for_sending"].includes(quote.status)) return { success: false, error: "Only approved/customer-approved quotes can be converted to orders." };

    const existingOrder = await supabase.from("orders").select("id").eq("company_id", context.companyId).eq("quote_id", quote.id).maybeSingle();
    if (existingOrder.error) throw existingOrder.error;
    if (existingOrder.data) return { success: false, error: "An order already exists for this quote." };

    const quoteItems = await supabase.from("quote_items").select("*").eq("quote_id", quote.id).eq("company_id", context.companyId).order("created_at");
    if (quoteItems.error) throw quoteItems.error;
    if (!(quoteItems.data ?? []).length) return { success: false, error: "Quote has no line items to convert." };
    const unapprovedLine = (quoteItems.data ?? []).find(hasUnapprovedDrawing);
    if (unapprovedLine) return { success: false, error: `Drawing approval is pending for section ${unapprovedLine.section_number ?? unapprovedLine.section_code ?? "line item"}.` };

    const existingOrders = await supabase.from("orders").select("order_number").eq("company_id", context.companyId);
    if (existingOrders.error) throw existingOrders.error;
    const orderNumber = nextBusinessNumber("O", (existingOrders.data ?? []).map((order: any) => order.order_number));
    const createdOrderResult = await supabase.from("orders").insert({
      company_id: context.companyId,
      dealer_id: context.dealerId ?? quote.dealer_id ?? null,
      order_number: orderNumber,
      quote_id: quote.id,
      customer_id: quote.customer_id,
      order_date: todayIso(),
      priority: "normal",
      current_stage: "order_confirmed",
      order_value: quote.grand_total,
      created_by: context.userId
    }).select("id").single();
    if (createdOrderResult.error || !createdOrderResult.data) throw createdOrderResult.error ?? new Error("Could not create order");

    const orderId = createdOrderResult.data.id;
    const orderItemsPayload = (quoteItems.data ?? []).map((item: any) => buildOrderItemFromQuoteItem(item, orderId, quote.id, context.companyId));
    const orderItemsResult = await supabase.from("order_items").insert(orderItemsPayload);
    if (orderItemsResult.error) throw orderItemsResult.error;
    const quoteUpdate = await supabase.from("quotes").update({ status: "converted_to_order" }).eq("id", quote.id).eq("company_id", context.companyId);
    if (quoteUpdate.error) throw quoteUpdate.error;

    revalidateQuoteOrderPaths(quote.id, orderId);
    return { success: true, quoteId: quote.id, orderId };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not convert quote to order") };
  }
}

export async function saveOrderAction(input: SaveOrderInput): Promise<ActionResult> {
  try {
    const context = await getSessionContext();
    const editingId = input.editing_id || null;
    if (!can(context.role, editingId ? "update" : "create", "orders")) return { success: false, error: "You do not have permission to save orders." };

    const parsed = orderSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Please check order details." };

    const supabase = await createClient();
    const [customerResult, currentOrderResult] = await Promise.all([
      supabase.from("customers").select("id").eq("company_id", context.companyId).eq("id", parsed.data.customer_id).maybeSingle(),
      editingId ? supabase.from("orders").select("*").eq("company_id", context.companyId).eq("id", editingId).maybeSingle() : Promise.resolve({ data: null, error: null })
    ]);
    if (customerResult.error) throw customerResult.error;
    if (currentOrderResult.error) throw currentOrderResult.error;
    if (!customerResult.data) return { success: false, error: "Selected customer is not available for this company." };
    if (editingId && !currentOrderResult.data) return { success: false, error: "Order not found for this company." };

    const selectedQuoteResult = parsed.data.quote_id
      ? await supabase
        .from("quotes")
        .select("id, customer_id, dealer_id, status")
        .eq("company_id", context.companyId)
        .eq("id", parsed.data.quote_id)
        .maybeSingle()
      : { data: null, error: null };
    if (selectedQuoteResult.error) throw selectedQuoteResult.error;
    if (parsed.data.quote_id && !selectedQuoteResult.data) return { success: false, error: "Selected quote is not available for this company." };
    if (selectedQuoteResult.data && selectedQuoteResult.data.customer_id !== parsed.data.customer_id) return { success: false, error: "Selected quote does not match this customer." };
    if (selectedQuoteResult.data && !["approved_for_sending", "customer_approved", "converted_to_order"].includes(selectedQuoteResult.data.status)) {
      return { success: false, error: "Only approved quotes can be linked to orders." };
    }

    const existingNumbers = editingId ? null : await supabase.from("orders").select("order_number").eq("company_id", context.companyId);
    if (existingNumbers?.error) throw existingNumbers.error;
    const currentOrder = currentOrderResult.data;
    const orderNumber = editingId ? currentOrder?.order_number : nextBusinessNumber("O", (existingNumbers?.data ?? []).map((order: any) => order.order_number));
    if (!orderNumber) return { success: false, error: "Could not identify the order number. Refresh and try again." };

    const payload = {
      ...parsed.data,
      quote_id: parsed.data.quote_id || null,
      production_profile_id: parsed.data.production_profile_id || null,
      production_die_id: parsed.data.production_die_id || null,
      expected_dispatch_date: parsed.data.expected_dispatch_date || null,
      production_notes: parsed.data.production_notes || null,
      notes: parsed.data.notes || null,
      dealer_id: context.dealerId ?? selectedQuoteResult.data?.dealer_id ?? currentOrder?.dealer_id ?? null,
      company_id: context.companyId,
      order_number: orderNumber,
      created_by: currentOrder?.created_by ?? context.userId
    };

    const result = editingId
      ? await supabase.from("orders").update(payload).eq("id", editingId).eq("company_id", context.companyId).select("id").single()
      : await supabase.from("orders").insert(payload).select("id").single();
    if (result.error || !result.data) throw result.error ?? new Error("Could not save order");

    revalidateOrderPaths(result.data.id);
    return { success: true, orderId: result.data.id };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not save order") };
  }
}

export async function updateOrderStageAction(orderId: string, stage: OrderStage): Promise<ActionResult> {
  try {
    const context = await getSessionContext();
    if (!can(context.role, "update", "orders")) return { success: false, error: "You do not have permission to update orders." };
    const parsedStage = orderSchema.shape.current_stage.safeParse(stage);
    if (!parsedStage.success) return { success: false, error: "Invalid order stage." };

    const supabase = await createClient();
    const updateResult = await supabase
      .from("orders")
      .update({ current_stage: parsedStage.data })
      .eq("id", orderId)
      .eq("company_id", context.companyId)
      .select("id")
      .maybeSingle();
    if (updateResult.error) throw updateResult.error;
    if (!updateResult.data) return { success: false, error: "Order not found for this company." };

    const historyResult = await supabase.from("order_stage_history").insert({
      company_id: context.companyId,
      order_id: orderId,
      stage: parsedStage.data,
      changed_by: context.userId,
      remarks: "Stage updated from order board"
    });
    if (historyResult.error) throw historyResult.error;

    revalidateOrderPaths(orderId);
    return { success: true, orderId };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not update order stage") };
  }
}
