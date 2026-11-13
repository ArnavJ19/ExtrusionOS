import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { buildInvoicePdf } from "@/lib/pdf/invoice-pdf";
import { companyLogo } from "@/lib/pdf/logo-loader-node";
import { qrRuns } from "@/lib/pdf/qr-modules";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await getSessionContext();
  if (!can(context.role, "read", "financials")) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  const parsed = z.string().uuid().safeParse((await params).id);
  if (!parsed.success) return NextResponse.json({ error: "Invalid invoice ID" }, { status: 400 });
  const supabase = await createClient();
  const [invoice, items] = await Promise.all([
    supabase.from("invoices").select("invoice_number,invoice_date,due_date,amount_paid,credited_amount,balance_due,status,subtotal,tax_total,grand_total,supplier_state_code,place_of_supply_state_code,cgst_amount,sgst_amount,utgst_amount,igst_amount,supplier_snapshot,customer_snapshot").eq("company_id", context.companyId).eq("id", parsed.data).maybeSingle(),
    supabase.from("invoice_items_authorized").select("item_description,hsn_code,quantity,unit_rate,line_total,gst_percent").eq("company_id", context.companyId).eq("invoice_id", parsed.data).order("created_at"),
  ]);
  if (invoice.error || items.error) return NextResponse.json({ error: "Invoice data is unavailable. Please try again or contact your administrator to check the database deployment." }, { status: 503 });
  if (!invoice.data) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  if (!invoice.data.supplier_snapshot || !invoice.data.customer_snapshot) return NextResponse.json({ error: "This legacy invoice predates party snapshots. Use its original issued document; current master details cannot verify the historical invoice." }, { status: 409 });
  // AP-082: an IRN recorded from the IRP prints with its signed QR. Readable only to finance roles; others get the invoice without it.
  const irnRead = await supabase.from("invoice_irns").select("irn,ack_no,ack_date,signed_qr").eq("company_id", context.companyId).eq("invoice_id", parsed.data).maybeSingle();
  const irn = irnRead.data ? { irn: irnRead.data.irn as string, ack_no: irnRead.data.ack_no as string, ack_date: irnRead.data.ack_date as string, qr: qrRuns(irnRead.data.signed_qr as string, "L") } : null;
  try {
    const bytes = await buildInvoicePdf({ company: invoice.data.supplier_snapshot, customer: invoice.data.customer_snapshot, invoice: invoice.data, items: items.data ?? [], logo: await companyLogo(supabase, context.companyId), irn });
    return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="invoice-${parsed.data}.pdf"`, "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Complete invoice supply states and line HSN codes before generating the PDF." }, { status: 409 });
  }
}
