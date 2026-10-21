"use server";

import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { repeatLineFields, repeatQuoteDraft, type RepeatedQuoteDraft } from "@/lib/forms/repeat-quote";
import { todayIso } from "@/lib/utils/format";

type RepeatResult = { success: true; sourceNumber: string; draft: RepeatedQuoteDraft; customer: any; profiles: any[] } | { success: false; error: string };

export async function repeatQuoteAction(input: string): Promise<RepeatResult> {
  try {
    const context = await getSessionContext();
    if (!["owner", "admin"].includes(context.role) || !can(context.role, "read", "quotes") || !can(context.role, "create", "quotes")) return { success: false, error: "Only an owner or admin permitted to prepare quotations can repeat priced lines." };
    const id = z.string().uuid().parse(input);
    const supabase = await createClient();
    const quote = await supabase.from("quotes_authorized").select("id, quote_number, customer_id, gst_percent, valid_until, terms_and_conditions, delivery_timeline, payment_terms, notes").eq("company_id", context.companyId).eq("id", id).maybeSingle();
    if (quote.error || !quote.data) throw new Error("Unavailable source");
    const [items, customer, settings] = await Promise.all([
      supabase.from("quote_items_authorized").select(repeatLineFields.join(", ")).eq("company_id", context.companyId).eq("quote_id", id).order("created_at").order("id").limit(101),
      supabase.from("customers").select("id, customer_name, company_name, gst_number, billing_address, shipping_address").eq("company_id", context.companyId).eq("id", quote.data.customer_id).eq("is_active", true).is("deleted_at", null).maybeSingle(),
      supabase.from("company_settings_authorized").select("default_quote_validity_days").eq("company_id", context.companyId).maybeSingle(),
    ]);
    if (items.error || !Array.isArray(items.data) || !items.data.length || items.data.length > 100 || customer.error || !customer.data || settings.error) return { success: false, error: "The source customer or lines are unavailable, or the quotation exceeds 100 lines. Review the source before repeating it." };
    const sourceItems = z.array(z.object({ profile_id: z.string().uuid() }).passthrough()).max(100).parse(items.data);
    const profileIds = [...new Set(sourceItems.map((item) => item.profile_id))];
    const profiles = await supabase.from("aluminium_profiles").select("id, profile_code, profile_name, section_weight_kg_per_m, section_perimeter_mm, drawing_revision, drawing_approval_status").eq("company_id", context.companyId).eq("is_active", true).in("id", profileIds).limit(100);
    if (profiles.error || !Array.isArray(profiles.data)) throw new Error("Unavailable profiles");
    const today = todayIso();
    const days = z.number().int().min(0).max(365).catch(15).parse(settings.data?.default_quote_validity_days ?? 15);
    const validUntil = new Date(Date.parse(`${today}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
    const draft = repeatQuoteDraft(quote.data, sourceItems, profiles.data, today, validUntil);
    return { success: true, sourceNumber: quote.data.quote_number || "Previous quotation", draft, customer: customer.data, profiles: profiles.data };
  } catch { return { success: false, error: "The previous quotation could not be repeated. Check current customer/profile availability and account access. No new quotation was saved." }; }
}
