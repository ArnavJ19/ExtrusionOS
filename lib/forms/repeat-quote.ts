import { quoteSchema } from "../validations/schemas";

export const repeatLineFields = ["profile_id", "item_description", "quantity_pieces", "length_per_piece_m", "section_weight_kg_per_m", "scrap_allowance_percent", "expected_recovery_percent", "minimum_billing_weight_kg", "billet_rate_per_kg", "conversion_charge_per_kg", "finishing_type", "finishing_charge_type", "finishing_charge", "die_amortization_type", "die_amortization_quantity_kg", "packing_charge", "transport_charge", "other_charges", "margin_percent", "sales_price_override", "minimum_margin_percent", "gst_percent"] as const;

export function repeatQuoteDraft(source: Record<string, any>, rows: Record<string, any>[], profiles: Record<string, any>[], today: string, validUntil: string) {
  if (!rows.length || rows.length > 100) throw new Error("Repeat supports quotations with 1 to 100 lines.");
  const byId = new Map(profiles.map((profile) => [profile.id, profile]));
  const items = rows.map((row) => {
    const profile = byId.get(row.profile_id);
    if (!profile || !Number.isFinite(Number(profile.section_weight_kg_per_m)) || Number(profile.section_weight_kg_per_m) <= 0) throw new Error("A source profile is inactive, unavailable, or missing section weight. Review the current profile before repeating this quotation.");
    const copied = Object.fromEntries(repeatLineFields.map((field) => [field, row[field]]));
    return quoteSchema.shape.items.element.parse({ ...copied, section_weight_kg_per_m: Number(profile.section_weight_kg_per_m), die_id: "", die_charge: 0, item_description: row.item_description ?? "", finishing_type: row.finishing_type ?? "mill_finish", finishing_charge_type: row.finishing_charge_type ?? "per_kg", die_amortization_type: row.die_amortization_type ?? "full_die_charge" });
  });
  const form = { customer_id: source.customer_id, quote_date: today, valid_until: validUntil, status: "draft" as const, gst_percent: Number(source.gst_percent), terms_and_conditions: source.terms_and_conditions ?? "", delivery_timeline: source.delivery_timeline ?? "", payment_terms: source.payment_terms ?? "", approval_notes: "", notes: source.notes ?? "" };
  return { form, items, expired: Boolean(source.valid_until && source.valid_until < today) };
}

export type RepeatedQuoteDraft = ReturnType<typeof repeatQuoteDraft>;
