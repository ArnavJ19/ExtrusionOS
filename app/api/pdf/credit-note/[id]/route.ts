import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { buildVoucherPdf, creditNoteVoucher } from "@/lib/pdf/finance-vouchers";
import { companyLogo } from "@/lib/pdf/logo-loader-node";
import { createClient } from "@/lib/supabase/server";

// Printable return credit note (PDF-05). Party details come from the invoice snapshots so the
// document matches the issued invoice, not current master data.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await getSessionContext();
  if (!can(context.role, "read", "financials")) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  const parsed = z.string().uuid().safeParse((await params).id);
  if (!parsed.success) return NextResponse.json({ error: "Invalid credit note ID" }, { status: 400 });
  const supabase = await createClient();
  const note = await supabase.from("credit_notes")
    .select("id, invoice_id, dispatch_id, credit_note_number, credit_date, reason, subtotal, tax_total, grand_total, status, item_snapshot, reversal_reason")
    .eq("company_id", context.companyId).eq("id", parsed.data).maybeSingle();
  if (note.error) return NextResponse.json({ error: "Credit note data is unavailable." }, { status: 503 });
  if (!note.data) return NextResponse.json({ error: "Credit note not found" }, { status: 404 });
  const [invoice, dispatch] = await Promise.all([
    supabase.from("invoices").select("invoice_number, invoice_date, supplier_snapshot, customer_snapshot")
      .eq("company_id", context.companyId).eq("id", note.data.invoice_id).maybeSingle(),
    supabase.from("dispatches").select("dispatch_number").eq("company_id", context.companyId).eq("id", note.data.dispatch_id).maybeSingle()
  ]);
  if (invoice.error || !invoice.data) return NextResponse.json({ error: "The credited invoice is unavailable." }, { status: 503 });
  if (!invoice.data.supplier_snapshot || !invoice.data.customer_snapshot) {
    return NextResponse.json({ error: "This legacy invoice predates party snapshots; its credit note cannot be reproduced from current master data." }, { status: 409 });
  }
  const bytes = await buildVoucherPdf({ ...creditNoteVoucher({ note: note.data, invoice: invoice.data, dispatchNumber: dispatch.data?.dispatch_number ?? null }), logo: await companyLogo(supabase, context.companyId) });
  return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="credit-note-${parsed.data}.pdf"`, "Cache-Control": "private, no-store" } });
}
