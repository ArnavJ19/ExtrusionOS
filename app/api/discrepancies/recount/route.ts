import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { submitDiscrepancyRecount } from "@/lib/enterprise/dealer-workflows";
import { createClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils/errors";

const recountSchema = z.object({
  discrepancy_id: z.string().uuid(),
  recount_quantity: z.number().nonnegative(),
  notes: z.string().optional().nullable()
});

export async function POST(request: Request) {
  try {
    const context = await getSessionContext();
    if (!can(context.role, "approve", "dealer_inventory")) return NextResponse.json({ error: "You do not have permission to submit recounts." }, { status: 403 });
    const parsed = recountSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid recount" }, { status: 400 });

    const supabase = await createClient();
    const discrepancyResult = await supabase
      .from("inventory_discrepancies")
      .select("id, dealer_id, expected_quantity, status")
      .eq("company_id", context.companyId)
      .eq("id", parsed.data.discrepancy_id)
      .single();
    if (discrepancyResult.error || !discrepancyResult.data) {
      return NextResponse.json({ error: "Discrepancy not found." }, { status: 404 });
    }
    if (context.dealerId && discrepancyResult.data.dealer_id !== context.dealerId) {
      return NextResponse.json({ error: "You can only recount discrepancies for your own dealership." }, { status: 403 });
    }
    if (["resolved", "closed", "cancelled"].includes(discrepancyResult.data.status)) {
      return NextResponse.json({ error: "This discrepancy is already closed." }, { status: 409 });
    }

    const result = await submitDiscrepancyRecount(supabase, {
      actor: {
        userId: context.userId,
        name: context.fullName ?? context.email,
        role: context.role,
        companyId: context.companyId,
        dealerId: context.dealerId,
        ipAddress: request.headers.get("x-forwarded-for"),
        userAgent: request.headers.get("user-agent")
      },
      discrepancyId: parsed.data.discrepancy_id,
      expectedQuantity: Number(discrepancyResult.data.expected_quantity ?? 0),
      recountQuantity: parsed.data.recount_quantity,
      notes: parsed.data.notes
    });
    if (result.error) return NextResponse.json({ error: getErrorMessage(result.error, "Could not submit recount") }, { status: 500 });
    return NextResponse.json(result.data);
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, "Recount submission failed") }, { status: 500 });
  }
}
