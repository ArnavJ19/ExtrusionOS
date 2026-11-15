// AP-008: browser calls for the quotation form (fetch to /api/quote-enquiry; no server module in the form's bundle). Any
// failure, including an older server without the route, comes back as a result, never thrown.
export type EnquiryDraftItem = { seq: number; profile_id: string; profile_code: string; item_description: string; quantity_pieces: number; length_per_piece_m: number; section_weight_kg_per_m: number;
  billet_rate_per_kg: number; billet_rate_found: boolean; conversion_charge_per_kg: number; finishing_type: string; finishing_charge_type: "per_kg" | "per_sqft"; finishing_charge: number;
  finishing_rate_found: boolean; packing_charge: number; transport_charge: number; margin_percent: number; minimum_margin_percent: number; gst_percent: number; confidence: string };
export type EnquiryQuoteDraft = { enquiry_id: string; enquiry_number: string; customer: { id: string; customer_name: string; company_name: string | null; gst_number: string | null; billing_address: string | null; shipping_address: string | null };
  items: EnquiryDraftItem[]; skipped: { seq: unknown; text: string | null; reason: string }[]; gst_percent: number; validity_days: number; notes: string; profiles: Record<string, unknown>[] };
type Result<T> = { success: true; data: T } | { success: false; error: string };

async function call<T>(body: Record<string, unknown>): Promise<Result<T>> {
  try {
    const response = await fetch("/api/quote-enquiry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json() as Result<T>;
    if (!data || typeof data !== "object" || typeof (data as { success?: unknown }).success !== "boolean") return { success: false, error: "The enquiry is not available." };
    return data;
  } catch {
    return { success: false, error: "The enquiry is not available. Check your connection and retry." };
  }
}

export const enquiryQuoteDraft = (id: string) => call<EnquiryQuoteDraft>({ command: "draft", id });
export const linkEnquiryQuote = (id: string, quoteId: string) => call<{ status: string }>({ command: "link", id, quote_id: quoteId });
