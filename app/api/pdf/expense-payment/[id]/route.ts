import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { buildVoucherPdf, supplierPaymentVoucher } from "@/lib/pdf/finance-vouchers";
import { createClient } from "@/lib/supabase/server";

// Printable supplier payment voucher (PDF-05).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await getSessionContext();
  if (!can(context.role, "read", "financials")) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  const parsed = z.string().uuid().safeParse((await params).id);
  if (!parsed.success) return NextResponse.json({ error: "Invalid payment ID" }, { status: 400 });
  const supabase = await createClient();
  const payment = await supabase.from("expense_payments")
    .select("id, expense_ledger_id, payment_date, amount_paid, payment_method, bank_account, reference_number, notes, status, reversed_at, reversal_reason")
    .eq("company_id", context.companyId).eq("id", parsed.data).maybeSingle();
  if (payment.error) return NextResponse.json({ error: "Payment data is unavailable." }, { status: 503 });
  if (!payment.data) return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  const [company, expense] = await Promise.all([
    supabase.from("companies").select("name, legal_name, gst_number, billing_address").eq("id", context.companyId).maybeSingle(),
    supabase.from("expense_ledger").select("expense_number, description, vendor_name_snapshot, invoice_number, invoice_date, balance_amount")
      .eq("company_id", context.companyId).eq("id", payment.data.expense_ledger_id).maybeSingle()
  ]);
  if (company.error || expense.error || !company.data || !expense.data) return NextResponse.json({ error: "Expense data is unavailable." }, { status: 503 });
  const bytes = await buildVoucherPdf(supplierPaymentVoucher({ company: company.data, payment: payment.data, expense: expense.data }));
  return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="payment-voucher-${parsed.data}.pdf"`, "Cache-Control": "private, no-store" } });
}
