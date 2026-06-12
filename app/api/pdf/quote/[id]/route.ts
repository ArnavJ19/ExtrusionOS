import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { buildQuotePdf } from "@/lib/pdf/quote-pdf";
import { getErrorMessage } from "@/lib/utils/errors";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const context = await getSessionContext();
    const supabase = await createClient();
    const [companyResult, settingsResult, quoteResult, itemsResult] = await Promise.all([
      supabase.from("companies").select("name, legal_name, gst_number, billing_address, city, state, pincode, phone, email").eq("id", context.companyId).single(),
      supabase.from("company_settings").select("default_quote_terms, default_terms_and_conditions, default_payment_terms, default_delivery_terms, bank_details, default_bank_details").eq("company_id", context.companyId).maybeSingle(),
      supabase.from("quotes").select("quote_number, revision_number, quote_date, valid_until, subtotal, gst_percent, gst_amount, grand_total, terms_and_conditions, delivery_timeline, payment_terms, customers(customer_name, company_name, gst_number, billing_address, shipping_address)").eq("company_id", context.companyId).eq("id", id).single(),
      supabase.from("quote_items").select("quantity_pieces, length_per_piece_m, total_meters, total_weight_kg, billing_weight_kg, price_per_kg, price_per_meter, line_total_before_gst, item_description, finishing_type, aluminium_profiles(profile_code, profile_name)").eq("company_id", context.companyId).eq("quote_id", id).order("created_at")
    ]);

    if (quoteResult.error || !quoteResult.data) return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    if (companyResult.error || !companyResult.data) return NextResponse.json({ error: "Company not found" }, { status: 404 });
    if (settingsResult.error) return NextResponse.json({ error: getErrorMessage(settingsResult.error) }, { status: 500 });
    if (itemsResult.error) return NextResponse.json({ error: getErrorMessage(itemsResult.error) }, { status: 500 });

    const bytes = await buildQuotePdf({ company: companyResult.data, settings: settingsResult.data, quote: quoteResult.data, items: itemsResult.data ?? [] });
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${quoteResult.data.quote_number}.pdf"`
      }
    });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, "Could not generate quotation PDF") }, { status: 500 });
  }
}
