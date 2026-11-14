import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { loadQuotePdf } from "@/lib/pdf/loaders";
import { getErrorMessage } from "@/lib/utils/errors";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const context = await getSessionContext();
    const result = await loadQuotePdf(await createClient(), context, id);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return new NextResponse(Buffer.from(result.bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${result.filename}"`
      }
    });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, "Could not generate quotation PDF") }, { status: 500 });
  }
}
