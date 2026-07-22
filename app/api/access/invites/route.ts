import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { sendInviteEmail } from "@/lib/communications/email";
import { logEnterpriseAuditEvent } from "@/lib/enterprise/audit";
import { createClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils/errors";

const inviteSchema = z.object({
  full_name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().optional(),
  role_id: z.string().uuid(),
  dealer_id: z.string().uuid().optional().nullable(),
  branch_id: z.string().uuid().optional().nullable(),
  sales_region: z.string().optional().nullable(),
  department: z.string().optional().nullable(),
  expires_in_days: z.number().int().min(1).max(30).default(7)
});

export async function POST(request: Request) {
  try {
    const context = await getSessionContext();
    if (!can(context.role, "create", "users")) return NextResponse.json({ error: "You do not have permission to invite users." }, { status: 403 });
    const parsed = inviteSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid invite" }, { status: 400 });

    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + parsed.data.expires_in_days * 24 * 60 * 60 * 1000).toISOString();
    const supabase = await createClient();

    const inviteResult = await supabase.from("invitations").insert({
      company_id: context.companyId,
      dealer_id: parsed.data.dealer_id ?? null,
      role_id: parsed.data.role_id,
      full_name: parsed.data.full_name,
      email: parsed.data.email.toLowerCase(),
      phone: parsed.data.phone ?? null,
      token_hash: tokenHash,
      branch_id: parsed.data.branch_id ?? null,
      sales_region: parsed.data.sales_region ?? null,
      department: parsed.data.department ?? null,
      invited_by: context.userId,
      expires_at: expiresAt
    }).select("id, email, full_name, expires_at").single();
    if (inviteResult.error || !inviteResult.data) return NextResponse.json({ error: getErrorMessage(inviteResult.error, "Could not create invite") }, { status: 500 });

    const inviteLink = `${new URL(request.url).origin}/accept-invite?token=${token}`;
    const emailResult = await sendInviteEmail({
      to: parsed.data.email,
      fullName: parsed.data.full_name,
      companyName: context.companyName,
      inviteLink,
      expiresAt
    });
    await supabase.from("notifications").insert({
      company_id: context.companyId,
      notification_type: "invite_sent",
      severity: "info",
      title: "User invite sent",
      body: emailResult.success ? `${parsed.data.full_name} was invited to ExtrusionOS and the email provider accepted the message.` : `${parsed.data.full_name} was invited, but email delivery is not configured: ${emailResult.error}`,
      related_entity_type: "invitation",
      related_entity_id: inviteResult.data.id,
      created_by: context.userId,
      dealer_id: parsed.data.dealer_id ?? null,
      action_link: "/settings/access",
      entity_reference: parsed.data.email
    });

    await logEnterpriseAuditEvent(supabase, {
      companyId: context.companyId,
      actorUserId: context.userId,
      actorName: context.fullName ?? context.email,
      actorRole: context.role,
      actorDealerId: context.dealerId,
      actionType: "invite_sent",
      moduleName: "access_control",
      entityType: "invitation",
      entityId: inviteResult.data.id,
      entityReferenceNumber: parsed.data.email,
      newValue: { ...parsed.data, token: "redacted" },
      changeSummary: emailResult.success ? `Invite sent to ${parsed.data.email}` : `Invite created for ${parsed.data.email}; email delivery not configured`,
      reason: emailResult.success ? null : emailResult.error
    });

    return NextResponse.json({ invite: inviteResult.data, email: emailResult });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, "Invite creation failed") }, { status: 500 });
  }
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
