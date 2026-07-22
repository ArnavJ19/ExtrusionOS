import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils/errors";

const schema = z.object({ order_id: z.string().uuid() });

export async function POST(request: Request) {
  try {
    const context = await getSessionContext();
    if (!can(context.role, "create", "dealer_orders")) return NextResponse.json({ error: "You do not have permission to create dealer orders." }, { status: 403 });

    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid order" }, { status: 400 });

    const supabase = await createClient();
    const result = await supabase.rpc("create_dealer_order_from_order_atomic", {
      p_order_id: parsed.data.order_id
    });
    if (result.error || !result.data) {
      const message = getErrorMessage(result.error, "Could not create dealer order workflow record");
      const status = result.error?.code === "42501" ? 403 : 500;
      return NextResponse.json({ error: message }, { status });
    }
    return NextResponse.json({ dealer_order: result.data });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, "Could not create dealer order workflow record") }, { status: 500 });
  }
}
