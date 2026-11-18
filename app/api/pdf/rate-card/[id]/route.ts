import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { RATE_CARD_READERS } from "@/lib/autopilot-batch9/commands";
import { buildRateCardPdf } from "@/lib/pdf/rate-card-pdf";
import { companyLogo } from "@/lib/pdf/logo-loader-node";
import type { RateCard } from "@/lib/commercial/rate-card";

// AP-073: a stored rate card as a PDF, read through the person's own session (selling prices only).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await getSessionContext();
  if (context.dealerId || !(RATE_CARD_READERS as readonly string[]).includes(context.role)) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  const parsed = z.string().uuid().safeParse((await params).id);
  if (!parsed.success) return NextResponse.json({ error: "Invalid rate card ID" }, { status: 400 });
  try {
    const supabase = await createClient();
    const card = await supabase.rpc("ap_rate_card", { p_command: "get", p_payload: { id: parsed.data } });
    if (card.error || !card.data) return NextResponse.json({ error: "Rate card not found" }, { status: 404 });
    const data = card.data as RateCard;
    const bytes = await buildRateCardPdf({ ...data, logo: await companyLogo(supabase, context.companyId) });
    return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${data.card_number}.pdf"`, "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "The rate card could not be generated." }, { status: 500 });
  }
}
