import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { loadInvoicePdf } from "@/lib/pdf/loaders";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await getSessionContext();
  if (!can(context.role, "read", "financials")) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  const parsed = z.string().uuid().safeParse((await params).id);
  if (!parsed.success) return NextResponse.json({ error: "Invalid invoice ID" }, { status: 400 });
  const result = await loadInvoicePdf(await createClient(), context, parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return new NextResponse(Buffer.from(result.bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${result.filename}"`, "Cache-Control": "private, no-store" } });
}
