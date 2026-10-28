import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { buildVoucherPdf, expenseVoucher } from "@/lib/pdf/finance-vouchers";
import { loadCompanyLogo } from "@/lib/pdf/logo-loader-node";
import { createClient } from "@/lib/supabase/server";

// Printable expense voucher with its settlement history (PDF-05).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await getSessionContext();
  if (!can(context.role, "read", "financials")) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  const parsed = z.string().uuid().safeParse((await params).id);
  if (!parsed.success) return NextResponse.json({ error: "Invalid expense ID" }, { status: 400 });
  const supabase = await createClient();
  const [company, expense, payments, credits] = await Promise.all([
    supabase.from("companies").select("name, legal_name, logo_url, gst_number, billing_address, city, state, pincode").eq("id", context.companyId).maybeSingle(),
    supabase.from("expense_ledger_authorized").select("*").eq("company_id", context.companyId).eq("id", parsed.data).maybeSingle(),
    supabase.from("expense_payments").select("payment_date, amount_paid, payment_method, reference_number, status").eq("company_id", context.companyId).eq("expense_ledger_id", parsed.data).order("payment_date"),
    supabase.from("expense_supplier_credits").select("credit_type, credit_date, amount, reference_number, status").eq("company_id", context.companyId).eq("expense_ledger_id", parsed.data).order("credit_date")
  ]);
  if (company.error || expense.error || payments.error || credits.error) return NextResponse.json({ error: "Expense data is unavailable." }, { status: 503 });
  if (!expense.data || !company.data) return NextResponse.json({ error: "Expense not found" }, { status: 404 });
  const bytes = await buildVoucherPdf({ ...expenseVoucher({ company: company.data, expense: expense.data, payments: payments.data ?? [], credits: credits.data ?? [] }), logo: await loadCompanyLogo(company.data.logo_url) });
  return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="expense-${parsed.data}.pdf"`, "Cache-Control": "private, no-store" } });
}
