import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { loadChallanPdf } from "@/lib/pdf/loaders";

// AP-091: the delivery challan of one dispatch (no prices).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await getSessionContext();
  if (context.dealerId || !can(context.role, "read", "dispatches")) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  const parsed = z.string().uuid().safeParse((await params).id);
  if (!parsed.success) return NextResponse.json({ error: "Invalid dispatch ID" }, { status: 400 });
  try {
    const result = await loadChallanPdf(await createClient(), context, parsed.data);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return new NextResponse(Buffer.from(result.bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${result.filename}"`, "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "The challan could not be generated. Retry, or check the dispatch's bundles." }, { status: 500 });
  }
}
