import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { logEnterpriseAuditEvent } from "@/lib/enterprise/audit";
import { createClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils/errors";

const schema = z.object({
  profile_id: z.string().uuid("Select a profile"),
  finish: z.string().trim().min(1, "Finish is required"),
  // Per-piece length; the database stores the batch total metres (pieces x length).
  piece_length_m: z.coerce.number().positive("Length per piece must be positive"),
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
    const profile = await supabase
      .from("aluminium_profiles")
      .select("id, section_weight_kg_per_m")
      .eq("company_id", context.companyId)
      .eq("id", parsed.data.profile_id)
      .eq("is_active", true)
      .maybeSingle();
    if (profile.error) return NextResponse.json({ error: getErrorMessage(profile.error, "Could not validate profile") }, { status: 500 });
    if (!profile.data) return NextResponse.json({ error: "Profile not found in this company or is inactive." }, { status: 400 });
    const totalMeters = parsed.data.piece_length_m * parsed.data.quantity_pieces;
    const sectionWeight = Number(profile.data.section_weight_kg_per_m ?? 0);
    if (sectionWeight > 0) {
      const expectedKg = totalMeters * sectionWeight;
      if (Math.abs(parsed.data.total_weight_kg - expectedKg) > expectedKg * 0.1) {
        return NextResponse.json({ error: `Weight ${parsed.data.total_weight_kg} kg does not match ${parsed.data.quantity_pieces} pcs x ${parsed.data.piece_length_m} m x ${sectionWeight} kg/m = ${expectedKg.toFixed(3)} kg (10% tolerance).` }, { status: 400 });
      }
    }

    const { data: batch, error } = await supabase
      .from("profile_stock_batches")
      .insert({
        company_id: context.companyId,
        dealer_id: context.dealerId,
        profile_id: parsed.data.profile_id,
        finish: parsed.data.finish,
        piece_length_m: parsed.data.piece_length_m,
        length_m: Number(totalMeters.toFixed(3)),
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
