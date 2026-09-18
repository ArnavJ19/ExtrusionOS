import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { logEnterpriseAuditEvent } from "@/lib/enterprise/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { getErrorMessage } from "@/lib/utils/errors";

const acceptSchema = z.object({
  token: z.string().min(20),
  password: z.string().min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number")
});

const CANONICAL_ROLE_KEYS = new Set([
  "owner", "admin", "sales_manager", "sales", "production_manager", "production",
  "dispatch_manager", "dispatch", "accounts", "quality", "viewer", "factory_manager",
  "inventory_manager", "dealer_admin", "dealer_staff"
]);

export async function POST(request: Request) {
  let createdAuthUserId: string | null = null;
  let accessCommitted = false;

  try {
    const parsed = acceptSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid invite acceptance" }, { status: 400 });

    const admin = createAdminClient();
    const tokenHash = createHash("sha256").update(parsed.data.token).digest("hex");
    const inviteResult = await admin.from("invitations").select("*, roles(id, company_id, role_key, name, is_system, is_active)").eq("token_hash", tokenHash).single();
    const invite = inviteResult.data as any;
    if (inviteResult.error || !invite) return NextResponse.json({ error: "Invite is invalid." }, { status: 404 });
    if (invite.status === "accepted") return NextResponse.json({ ok: true, email: invite.email, alreadyAccepted: true });
    if (invite.status !== "pending") return NextResponse.json({ error: `Invite is already ${invite.status}.` }, { status: 400 });
    if (new Date(invite.expires_at).getTime() < Date.now()) {
      await admin.from("invitations").update({ status: "expired" }).eq("id", invite.id).eq("status", "pending");
      await logEnterpriseAuditEvent(admin, { companyId: invite.company_id, actionType: "invite_expired", moduleName: "access_control", entityType: "invitation", entityId: invite.id, entityReferenceNumber: invite.email, status: "failed", changeSummary: "Invite expired before acceptance" });
      return NextResponse.json({ error: "Invite has expired." }, { status: 400 });
    }

    const role = invite.roles;
    if (!role || role.company_id !== invite.company_id || !role.is_active) {
      return NextResponse.json({ error: "The role assigned to this invite is no longer available for this company." }, { status: 400 });
    }
    if (!role.is_system || !CANONICAL_ROLE_KEYS.has(role.role_key)) {
      return NextResponse.json({ error: "This invite uses a custom role that cannot be activated safely yet. Ask an owner to revoke it and send a new invite with a default role." }, { status: 400 });
    }

    const scopeError = await validateInvitationScope(admin, invite);
    if (scopeError) return NextResponse.json({ error: scopeError }, { status: 400 });

    const roleKey = role.role_key;
    const userResult = await createInvitedAuthUser(admin, invite.email, parsed.data.password, invite.full_name);
    if (userResult.error || !userResult.userId) return NextResponse.json({ error: userResult.error ?? "Could not create invited user" }, { status: userResult.status ?? 500 });
    const userId = userResult.userId;
    createdAuthUserId = userId;

    const claimResult = await admin.rpc("accept_invitation_atomic" as any, {
      target_invitation_id: invite.id,
      target_user_id: userId
    });
    const claim = claimResult.data as { status?: string } | null;
    if (claimResult.error || claim?.status !== "accepted") {
      const cleanupError = await deleteNewAuthUser(admin, createdAuthUserId);
      createdAuthUserId = null;
      const reason = claim?.status === "expired"
        ? "Invite has expired."
        : claim?.status === "invalid_role"
          ? "The role assigned to this invite is no longer valid. Ask an owner to send a new invite."
          : claim?.status === "invalid_scope"
            ? "The dealer or branch assigned to this invite is no longer valid. Ask an owner to send a new invite."
            : claim?.status === "already_accepted" || claim?.status === "not_pending"
              ? "Invite has already been accepted or is no longer pending."
              : getErrorMessage(claimResult.error, "Could not activate invited access");
      const suffix = cleanupError ? " No application access was activated, but the temporary login could not be removed automatically." : "";
      const status = claim?.status === "expired" || claim?.status === "invalid_role" || claim?.status === "invalid_scope"
        ? 400
        : claim?.status === "already_accepted" || claim?.status === "not_pending"
          ? 409
          : 500;
      return NextResponse.json({ error: `${reason}${suffix}` }, { status });
    }
    accessCommitted = true;

    await Promise.allSettled([
      admin.from("notifications").insert({
        company_id: invite.company_id,
        dealer_id: invite.dealer_id,
        notification_type: "invite_accepted",
        severity: "success",
        title: "Invite accepted",
        body: `${invite.full_name} accepted their ExtrusionOS invite.`,
        related_entity_type: "app_user",
        related_entity_id: userId,
        entity_reference: invite.email
      }),
      logEnterpriseAuditEvent(admin, {
        companyId: invite.company_id,
        actorUserId: userId,
        actorName: invite.full_name,
        actorRole: roleKey,
        actorDealerId: invite.dealer_id,
        actionType: "invite_accepted",
        moduleName: "access_control",
        entityType: "invitation",
        entityId: invite.id,
        entityReferenceNumber: invite.email,
        changeSummary: `${invite.email} accepted invite`,
        ipAddress: request.headers.get("x-forwarded-for"),
        userAgent: request.headers.get("user-agent")
      })
    ]);

    return NextResponse.json({ ok: true, email: invite.email });
  } catch (error) {
    if (createdAuthUserId && !accessCommitted) {
      const admin = createAdminClient();
      await deleteNewAuthUser(admin, createdAuthUserId);
    }
    return NextResponse.json({ error: getErrorMessage(error, "Invite acceptance failed") }, { status: 500 });
  }
}

async function createInvitedAuthUser(admin: ReturnType<typeof createAdminClient>, email: string, password: string, fullName: string) {
  const createdUser = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName }
  });

  if (createdUser.data.user) return { userId: createdUser.data.user.id };
  const message = getErrorMessage(createdUser.error, "Could not create invited user");
  if (!/already|registered|exists/i.test(message)) return { error: message };
  return { error: "An account already exists for this email. Sign in with that account, use password reset if needed, and ask an owner/admin to assign access from Users & Roles.", status: 409 };
}

async function validateInvitationScope(admin: ReturnType<typeof createAdminClient>, invite: Record<string, any>) {
  if (invite.dealer_id) {
    const dealer = await admin.from("dealers").select("id").eq("id", invite.dealer_id).eq("company_id", invite.company_id).eq("is_active", true).maybeSingle();
    if (dealer.error || !dealer.data) return "The dealership assigned to this invite is no longer active for this company.";
  }
  if (invite.branch_id) {
    const branch = await admin.from("branches").select("id").eq("id", invite.branch_id).eq("company_id", invite.company_id).eq("is_active", true).maybeSingle();
    if (branch.error || !branch.data) return "The branch assigned to this invite is no longer active for this company.";
  }
  return null;
}

async function deleteNewAuthUser(admin: ReturnType<typeof createAdminClient>, userId: string | null) {
  if (!userId) return null;
  const result = await admin.auth.admin.deleteUser(userId);
  return result.error ? getErrorMessage(result.error, "Could not remove temporary login") : null;
}
