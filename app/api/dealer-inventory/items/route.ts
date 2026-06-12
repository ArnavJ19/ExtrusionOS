import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { logEnterpriseAuditEvent } from "@/lib/enterprise/audit";
import { createClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils/errors";

const schema = z.object({
  profile_id: z.string().uuid("Select a profile"),
  finish: z.string().trim().min(1, "Finish is required"),
  length_m: z.coerce.number().positive("Length must be positive"),
  quantity_pieces: z.coerce.number().int().positive("Pieces must be positive"),
  total_weight_kg: z.coerce.number().positive("Weight must be positive"),
  bundle_number: z.string().trim().optional(),
  location: z.string().trim().optional(),
  notes: z.string().trim().optional()
});

export async function POST(request: Request) {
  try {
    const context = await getSessionContext();
    if (!context.dealerId || !["dealer_admin", "dealer_staff"].includes(context.role)) {
      return NextResponse.json({ error: "Dealer inventory entry is only available to dealer users." }, { status: 403 });
    }

    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid inventory item" }, { status: 400 });

    const supabase = await createClient();
    const { data: batch, error } = await supabase
      .from("profile_stock_batches")
      .insert({
        company_id: context.companyId,
        dealer_id: context.dealerId,
        profile_id: parsed.data.profile_id,
        finish: parsed.data.finish,
        length_m: parsed.data.length_m,
        quantity_pieces: parsed.data.quantity_pieces,
        total_weight_kg: parsed.data.total_weight_kg,
        bundle_number: parsed.data.bundle_number || null,
        location: parsed.data.location || null,
        notes: parsed.data.notes || null,
        status: "available"
      })
      .select("id")
      .single();
    if (error || !batch) return NextResponse.json({ error: getErrorMessage(error, "Could not add dealer inventory") }, { status: 500 });

    await logEnterpriseAuditEvent(supabase, {
      companyId: context.companyId,
      actorUserId: context.userId,
      actorName: context.fullName ?? context.email,
      actorRole: context.role,
      actorDealerId: context.dealerId,
      actionType: "dealer_inventory_manual_entry",
      moduleName: "dealer_inventory",
      entityType: "profile_stock_batch",
      entityId: batch.id,
      newValue: parsed.data,
      changeSummary: "Dealer inventory batch created manually"
    });

    return NextResponse.json({ batch });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, "Could not add dealer inventory") }, { status: 500 });
  }
}
