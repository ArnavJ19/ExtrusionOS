import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { buildStatementPdf, type StatementDocument } from "@/lib/pdf/statement-pdf";
import { companyLogo } from "@/lib/pdf/logo-loader-node";
import { STATEMENT_ROLES } from "@/lib/autopilot-batch7/commands";

// AP-079: printable monthly statement. Read through the statement gateway (company and role checked in the database);
// the document is built only from the stored statement of that one customer.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await getSessionContext();
  if (context.dealerId || !(STATEMENT_ROLES as readonly string[]).includes(context.role)) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  const parsed = z.string().uuid().safeParse((await params).id);
  if (!parsed.success) return NextResponse.json({ error: "Invalid statement ID" }, { status: 400 });
  const supabase = await createClient();
  const read = await supabase.rpc("ap_statement", { p_command: "get", p_payload: { id: parsed.data } });
  if (read.error) return NextResponse.json({ error: read.error.message?.startsWith("AP: ") ? read.error.message.slice(4) : "The statement is unavailable." }, { status: read.error.code === "42501" ? 403 : 404 });
  const s = read.data as Record<string, any>;
  const doc: StatementDocument = {
    company: { name: s.company?.name ?? "Company", legal_name: s.company?.legal_name ?? null, gst_number: s.company?.gst_number ?? null, address: s.company?.address || null },
    customer: { name: s.customer_details?.name ?? s.customer ?? "Customer", gst_number: s.customer_details?.gst_number ?? null, address: s.customer_details?.address || null },
    period_start: s.period_start, period_end: s.period_end,
    opening_balance: Number(s.opening_balance), invoiced: Number(s.invoiced), received: Number(s.received), credited: Number(s.credited),
    closing_balance: Number(s.closing_balance), on_account: Number(s.on_account ?? 0),
    lines: (s.lines ?? []).map((l: Record<string, unknown>) => ({ ...l, debit: Number(l.debit), credit: Number(l.credit), balance: Number(l.balance) })),
    open_invoices: (s.open_invoices ?? []).map((x: Record<string, unknown>) => ({ ...x, total: Number(x.total), balance: Number(x.balance), days_overdue: Number(x.days_overdue ?? 0) })),
    logo: await companyLogo(supabase, context.companyId)
  };
  try {
    const bytes = await buildStatementPdf(doc);
    const name = `statement-${String(s.period_start).slice(0, 7)}-${String(s.customer ?? "customer").replace(/[^A-Za-z0-9]+/g, "-").slice(0, 40)}.pdf`;
    return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${name}"`, "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "The statement PDF could not be built." }, { status: 500 });
  }
}
