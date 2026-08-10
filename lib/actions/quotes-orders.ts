"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { calculateQuoteItem, calculateQuoteSummary } from "@/lib/calculations/quote";
import { buildQuoteItemPcdaFields, hasUnapprovedDrawing } from "@/lib/pcda/quote-order";
import { createClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils/errors";
import { todayIso } from "@/lib/utils/format";
import { orderSchema, quoteSchema } from "@/lib/validations/schemas";
import { canTransitionQuoteStatus } from "@/lib/workflow/quote-status";
import type { QuoteStatus } from "@/types/app";

const quoteStatusSchema = z.enum(["draft", "internal_review", "approved_for_sending", "sent", "customer_approved", "customer_rejected", "expired", "converted_to_order"]);
const revisionLockedStatuses = ["approved_for_sending", "sent", "customer_approved", "customer_rejected", "expired", "converted_to_order"];
const lowMarginApprovalRoles = ["owner", "admin", "sales_manager"];
const profileSelect = "id, profile_code, profile_name, section_weight_kg_per_m, surface_area_per_meter_sqm, section_number, section_code, section_name, drawing_document_id, drawing_revision, drawing_approval_status, alloy_standard_id, alloy_id, temper_id, min_weight, max_weight, weight_tolerance, actual_weight_kg_per_m, standard_length, bundle_quantity, pieces_per_bundle, meter_per_bundle, kg_per_bundle";
const unusableDieStatuses = ["inactive", "dead", "blocked", "retired", "scrapped", "under_maintenance"];

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

    // Cost items only after profiles are loaded so per_sqft finishing uses the profile's
    // authoritative surface area (sq.m/m) rather than any client-supplied value.
    const calculatedItems = parsed.data.items.map((item) => calculateQuoteItem({
      ...item,
      surface_area_per_meter_sqm: (profilesById.get(item.profile_id) as any)?.surface_area_per_meter_sqm ?? null
    }));
    const summary = calculateQuoteSummary(calculatedItems, parsed.data.gst_percent);

    const currentQuote = currentQuoteResult.data;
    if (currentQuote?.status === "converted_to_order") {
      return { success: false, error: "Converted quotes cannot be revised. Update the linked order instead." };
    }
    const needsRevision = Boolean(editingId && currentQuote && revisionLockedStatuses.includes(currentQuote.status));
    const nextRevisionNumber = needsRevision ? Number(currentQuote?.revision_number ?? 1) + 1 : Number(currentQuote?.revision_number ?? 1);
    const quotePayload = {
      customer_id: parsed.data.customer_id,
      quote_date: parsed.data.quote_date,
      valid_until: parsed.data.valid_until || null,
      gst_percent: summary.gst_percent,
      terms_and_conditions: parsed.data.terms_and_conditions || null,
      delivery_timeline: parsed.data.delivery_timeline || null,
      payment_terms: parsed.data.payment_terms || null,
      approval_notes: parsed.data.approval_notes || null,
      notes: parsed.data.notes || null
    };

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
        // quote_items.other_charges / packing_charge are NOT NULL (default 0). The PCDA
        // mapping validates them as positive-or-null (null for 0), so re-assert them as
        // numbers here so a 0-charge line does not violate the NOT NULL constraint.
        other_charges: Number(calculatedItem.other_charges ?? 0),
        packing_charge: Number(calculatedItem.packing_charge ?? 0),
        profile_id: item.profile_id,
        die_id: item.die_id || null,
        item_description: item.item_description || null,
        finishing_type: item.finishing_type
      };
    });
    const quoteResult = await supabase.rpc("save_quote_atomic", {
      p_quote_id: editingId,
      p_quote: quotePayload,
      p_items: itemPayload,
      p_expected_revision: editingId ? Number(currentQuote?.revision_number ?? 1) : null,
      p_expected_updated_at: editingId ? currentQuote?.updated_at ?? null : null,
      p_revision_reason: parsed.data.approval_notes || "Commercial revision"
    });
    if (quoteResult.error || !quoteResult.data) throw quoteResult.error ?? new Error("Could not save quote");
    const quoteId = String(quoteResult.data);

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
      .select("id, status, low_margin_approval_required")
      .eq("id", quoteId)
      .eq("company_id", context.companyId)
      .maybeSingle();
    if (quoteResult.error) throw quoteResult.error;
    if (!quoteResult.data) return { success: false, error: "Quote not found for this company." };
    const currentStatus = quoteResult.data.status as QuoteStatus;
    if (!canTransitionQuoteStatus(currentStatus, parsedStatus.data)) {
      return { success: false, error: `Quote cannot move from ${currentStatus.replace(/_/g, " ")} to ${parsedStatus.data.replace(/_/g, " ")}.` };
    }
    if (quoteResult.data.low_margin_approval_required && ["approved_for_sending", "sent", "customer_approved"].includes(parsedStatus.data) && !isLowMarginApprover(context.role)) {
      return { success: false, error: "This low-margin quote needs owner/admin approval." };
    }

    const nowIso = new Date().toISOString();
    const metadata = {
      ...(parsedStatus.data === "draft" ? { approved_by: null, approved_at: null, sent_at: null, customer_decision_at: null } : {}),
      ...(parsedStatus.data === "approved_for_sending" && isLowMarginApprover(context.role) ? { approved_by: context.userId, approved_at: nowIso } : {}),
      ...(parsedStatus.data === "sent" ? { sent_at: nowIso } : {}),
      ...(["customer_approved", "customer_rejected"].includes(parsedStatus.data) ? { customer_decision_at: nowIso } : {})
    };
    const updateResult = await supabase
      .from("quotes")
      .update({ status: parsedStatus.data, ...metadata })
      .eq("id", quoteId)
      .eq("company_id", context.companyId)
      .eq("status", currentStatus)
      .select("id")
      .maybeSingle();
    if (updateResult.error) throw updateResult.error;
    if (!updateResult.data) return { success: false, error: "The quote changed while you were reviewing it. Refresh and try again." };

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

    const existingOrder = await supabase.from("orders").select("id").eq("company_id", context.companyId).eq("quote_id", quote.id).maybeSingle();
    if (existingOrder.error) throw existingOrder.error;
    if (existingOrder.data) {
      revalidateQuoteOrderPaths(quote.id, existingOrder.data.id);
      return { success: true, quoteId: quote.id, orderId: existingOrder.data.id };
    }
    if (quote.status !== "customer_approved") return { success: false, error: "Only customer-approved quotes can be converted to orders." };

    const quoteItems = await supabase.from("quote_items").select("*").eq("quote_id", quote.id).eq("company_id", context.companyId).order("created_at");
    if (quoteItems.error) throw quoteItems.error;
    if (!(quoteItems.data ?? []).length) return { success: false, error: "Quote has no line items to convert." };
    const unapprovedLine = (quoteItems.data ?? []).find(hasUnapprovedDrawing);
    if (unapprovedLine) return { success: false, error: `Drawing approval is pending for section ${unapprovedLine.section_number ?? unapprovedLine.section_code ?? "line item"}.` };

    // Order number and stage are generated server-side by convert_quote_to_order_atomic
    // under an advisory lock; do not compute them here (the RPC ignores extra keys).
    const atomicResult = await supabase.rpc("convert_quote_to_order_atomic", {
      p_quote_id: quote.id,
      p_order: {
        order_date: todayIso(),
        priority: "normal",
        order_value: quote.grand_total
      }
    });
    if (atomicResult.error || !atomicResult.data) throw atomicResult.error ?? new Error("Could not create order");
    const orderId = String(atomicResult.data);

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

    const currentOrder = currentOrderResult.data;
    if (currentOrder) {
      const sameOptionalId = (requested: unknown, stored: unknown) => String(requested || "") === String(stored || "");
      const sameNumber = (requested: unknown, stored: unknown) => Math.abs(Number(requested ?? 0) - Number(stored ?? 0)) < 0.000001;
      // Commercial identity is fully immutable after creation.
      const identityChanged =
        !sameOptionalId(parsed.data.customer_id, currentOrder.customer_id)
        || !sameOptionalId(parsed.data.quote_id, currentOrder.quote_id)
        || !sameNumber(parsed.data.order_value, currentOrder.order_value)
        || parsed.data.order_date !== currentOrder.order_date;
      // Production requirement fields may be populated once (null/zero -> value) when
      // engineering decides them after order creation, but cannot be changed once set.
      const idLockedOnceSet = (requested: unknown, stored: unknown) => Boolean(String(stored || "")) && !sameOptionalId(requested, stored);
      const numberLockedOnceSet = (requested: unknown, stored: unknown) => Number(stored ?? 0) !== 0 && !sameNumber(requested, stored);
      const productionRequirementChanged =
        idLockedOnceSet(parsed.data.production_profile_id, currentOrder.production_profile_id)
        || idLockedOnceSet(parsed.data.production_die_id, currentOrder.production_die_id)
        || numberLockedOnceSet(parsed.data.production_quantity_kg, currentOrder.production_quantity_kg)
        || numberLockedOnceSet(parsed.data.production_pieces, currentOrder.production_pieces)
        || numberLockedOnceSet(parsed.data.billet_diameter_required_inch, currentOrder.billet_diameter_required_inch);

      if (identityChanged) {
        return {
          success: false,
          error: "Customer, source quote, order date, and value are fixed after order creation. Create a new order or revise the source quote instead."
        };
      }
      if (productionRequirementChanged) {
        return {
          success: false,
          error: "Production profile, die, quantity, pieces, and billet diameter cannot be changed once set. Create a new order if the production requirement has to change."
        };
      }
    }

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
    const allowedLinkedQuoteStatuses = editingId ? ["customer_approved", "converted_to_order"] : ["customer_approved"];
    if (selectedQuoteResult.data && !allowedLinkedQuoteStatuses.includes(selectedQuoteResult.data.status)) {
      return { success: false, error: "Only customer-approved quotes can be linked to a new order." };
    }

    if (parsed.data.production_profile_id || parsed.data.production_die_id) {
      if (!parsed.data.production_profile_id || !parsed.data.production_die_id) {
        return { success: false, error: "Production profile and die must be selected together for direct production requirements." };
      }
      const [profileResult, dieResult] = await Promise.all([
        supabase
          .from("aluminium_profiles")
          .select("id, is_active, billet_diameter_required_inch")
          .eq("company_id", context.companyId)
          .eq("id", parsed.data.production_profile_id)
          .maybeSingle(),
        supabase
          .from("dies")
          .select("id, profile_id, die_status, billet_diameter_required_inch")
          .eq("company_id", context.companyId)
          .eq("id", parsed.data.production_die_id)
          .maybeSingle()
      ]);
      if (profileResult.error) throw profileResult.error;
      if (dieResult.error) throw dieResult.error;
      if (!profileResult.data) return { success: false, error: "Selected production profile is not available for this company." };
      if (profileResult.data.is_active === false) return { success: false, error: "Selected production profile is inactive." };
      if (!dieResult.data || dieResult.data.profile_id !== parsed.data.production_profile_id) return { success: false, error: "Selected production die does not match the production profile." };
      if (unusableDieStatuses.includes(String(dieResult.data.die_status ?? ""))) return { success: false, error: `Production die is ${String(dieResult.data.die_status).replace(/_/g, " ")} and cannot be used.` };
      const profileDiameter = Number(profileResult.data.billet_diameter_required_inch ?? 0);
      const dieDiameter = Number(dieResult.data.billet_diameter_required_inch ?? 0);
      const requestedDiameter = Number(parsed.data.billet_diameter_required_inch ?? 0);
      const expectedDiameter = requestedDiameter || dieDiameter || profileDiameter;
      if (expectedDiameter > 0 && dieDiameter > 0 && Math.abs(expectedDiameter - dieDiameter) > 0.001) {
        return { success: false, error: "Required billet diameter does not match the selected die." };
      }
      if (expectedDiameter > 0 && profileDiameter > 0 && Math.abs(expectedDiameter - profileDiameter) > 0.001) {
        return { success: false, error: "Required billet diameter does not match the selected profile." };
      }
    }

    const payload = {
      ...parsed.data,
      current_stage: editingId ? currentOrder?.current_stage ?? "order_confirmed" : "order_confirmed",
      quote_id: parsed.data.quote_id || null,
      production_profile_id: parsed.data.production_profile_id || null,
      production_die_id: parsed.data.production_die_id || null,
      expected_dispatch_date: parsed.data.expected_dispatch_date || null,
      production_notes: parsed.data.production_notes || null,
      notes: parsed.data.notes || null,
      dealer_id: context.dealerId ?? selectedQuoteResult.data?.dealer_id ?? currentOrder?.dealer_id ?? null,
      ...(editingId ? { order_number: currentOrder?.order_number } : {})
    };

    const result = await supabase.rpc("save_order_atomic", {
      p_order_id: editingId,
      p_order: payload
    });
    if (result.error || !result.data) throw result.error ?? new Error("Could not save order");

    const orderId = String(result.data);
    revalidateOrderPaths(orderId);
    return { success: true, orderId };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not save order") };
  }
}
