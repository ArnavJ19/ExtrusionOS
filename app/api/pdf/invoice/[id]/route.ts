import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { buildInvoicePdf } from "@/lib/pdf/invoice-pdf";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await getSessionContext();
  if (!can(context.role, "read", "financials")) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  const parsed = z.string().uuid().safeParse((await params).id);
  if (!parsed.success) return NextResponse.json({ error: "Invalid invoice ID" }, { status: 400 });
  const supabase = await createClient();
  const [invoice, items] = await Promise.all([
    supabase.from("invoices").select("invoice_number,invoice_date,status,subtotal,tax_total,grand_total,supplier_state_code,place_of_supply_state_code,cgst_amount,sgst_amount,utgst_amount,igst_amount,supplier_snapshot,customer_snapshot").eq("company_id", context.companyId).eq("id", parsed.data).maybeSingle(),
    supabase.from("invoice_items_authorized").select("item_description,hsn_code,quantity,unit_rate,line_total,gst_percent").eq("company_id", context.companyId).eq("invoice_id", parsed.data).order("created_at"),
  ]);
  if (invoice.error || items.error) return NextResponse.json({ error: "Invoice data is unavailable. Please try again or contact your administrator to check the database deployment." }, { status: 503 });
  if (!invoice.data) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  if (!invoice.data.supplier_snapshot || !invoice.data.customer_snapshot) return NextResponse.json({ error: "This legacy invoice predates party snapshots. Use its original issued document; current master details cannot verify the historical invoice." }, { status: 409 });
  try {
    const bytes = await buildInvoicePdf({ company: invoice.data.supplier_snapshot, customer: invoice.data.customer_snapshot, invoice: invoice.data, items: items.data ?? [] });
    return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="invoice-${parsed.data}.pdf"`, "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Complete invoice supply states and line HSN codes before generating the PDF." }, { status: 409 });
  }
}
