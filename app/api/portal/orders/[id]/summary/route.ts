import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { portalOrderDocument } from "@/lib/workflow/customer-self-service";
import { z } from "zod";

const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return new NextResponse("Order unavailable", { status: 404, headers: privateHeaders });
    const client = await createClient();
    const user = await client.auth.getUser();
    if (user.error || !user.data.user) return new NextResponse("Authentication required", { status: 401, headers: privateHeaders });
    const result = await client.rpc("portal_self_service_command", { p_command: "order.load", p_payload: { order_id: id } });
    if (result.error || result.data?.kind !== "order") return new NextResponse("Order unavailable", { status: 404, headers: privateHeaders });
    return new NextResponse(portalOrderDocument(result.data.order, result.data.version), { headers: {
      ...privateHeaders, "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": "attachment; filename=order-summary.txt"
    } });
  } catch {
    return new NextResponse("Summary unavailable", { status: 503, headers: privateHeaders });
  }
}
