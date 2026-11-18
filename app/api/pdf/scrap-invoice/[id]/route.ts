import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SCRAP_READERS } from "@/lib/autopilot-batch9/commands";
import { buildScrapInvoicePdf, type ScrapInvoice } from "@/lib/pdf/scrap-invoice-pdf";
import { companyLogo } from "@/lib/pdf/logo-loader-node";

// AP-074: the tax invoice of an invoiced scrap sale, read through the person's own session.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await getSessionContext();
  if (context.dealerId || !(SCRAP_READERS as readonly string[]).includes(context.role)) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  const parsed = z.string().uuid().safeParse((await params).id);
  if (!parsed.success) return NextResponse.json({ error: "Invalid sale ID" }, { status: 400 });
  try {
    const supabase = await createClient();
    const sale = await supabase.rpc("ap_scrap_sale", { p_command: "sale", p_payload: { id: parsed.data } });
    if (sale.error || !sale.data) return NextResponse.json({ error: "Scrap sale not found" }, { status: 404 });
    const data = sale.data as ScrapInvoice & { status: string };
    if (!data.invoice_number) return NextResponse.json({ error: "This sale is not invoiced yet" }, { status: 409 });
    const bytes = await buildScrapInvoicePdf({ ...data, logo: await companyLogo(supabase, context.companyId) });
    return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${data.invoice_number.replaceAll("/", "-")}.pdf"`, "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "The scrap invoice could not be generated." }, { status: 500 });
  }
}
