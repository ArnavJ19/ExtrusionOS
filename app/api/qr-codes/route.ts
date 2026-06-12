import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { fetchQrEntityDetails, QR_ENTITY_LABELS, QR_ENTITY_TYPES } from "@/lib/qr/entities";
import { buildQrPayload } from "@/lib/qr/payload";
import { createClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils/errors";

const qrSchema = z.object({
  entity_type: z.enum(QR_ENTITY_TYPES),
  entity_id: z.string().uuid(),
});

export async function POST(request: Request) {
  try {
    const context = await getSessionContext();
    if (!can(context.role, "create", "inventory") && !can(context.role, "create", "dispatches") && !can(context.role, "create", "production")) {
      return NextResponse.json({ error: "You do not have permission to create QR codes." }, { status: 403 });
    }

    const parsed = qrSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid QR request" }, { status: 400 });

    const supabase = await createClient();
    const entityDetails = await fetchQrEntityDetails(supabase, parsed.data.entity_type, parsed.data.entity_id, context.companyId);
    if (!entityDetails) return NextResponse.json({ error: `No ${QR_ENTITY_LABELS[parsed.data.entity_type]} found for this UUID.` }, { status: 404 });

    const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
    const label = String(entityDetails.display_label ?? parsed.data.entity_id);
    const { data, error } = await supabase
      .from("qr_codes")
      .insert({
        company_id: context.companyId,
        entity_type: parsed.data.entity_type,
        entity_id: parsed.data.entity_id,
        qr_value: buildQrPayload({ companyId: context.companyId, entityType: parsed.data.entity_type, entityId: parsed.data.entity_id, nonce: crypto.randomUUID() }),
        status: "active",
        expires_at: expiresAt,
        label,
        created_by: context.userId,
      })
      .select("id")
      .single();

    if (error || !data) return NextResponse.json({ error: getErrorMessage(error, "Could not create QR code") }, { status: 500 });
    return NextResponse.json({ qr_code: data });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, "Could not create QR code") }, { status: 500 });
  }
}
