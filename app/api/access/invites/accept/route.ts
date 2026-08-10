import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { defaultRolePermissions } from "@/lib/auth/permissions";
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

export async function POST(request: Request) {
  try {
    const parsed = acceptSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid invite acceptance" }, { status: 400 });

    const admin = createAdminClient();
    const tokenHash = createHash("sha256").update(parsed.data.token).digest("hex");
    const inviteResult = await admin.from("invitations").select("*, roles(id, role_key, name)").eq("token_hash", tokenHash).single();
    const invite = inviteResult.data as any;
    if (inviteResult.error || !invite) return NextResponse.json({ error: "Invite is invalid." }, { status: 404 });
    if (invite.status !== "pending") return NextResponse.json({ error: `Invite is already ${invite.status}.` }, { status: 400 });
    if (new Date(invite.expires_at).getTime() < Date.now()) {
      await admin.from("invitations").update({ status: "expired" }).eq("id", invite.id);
      await logEnterpriseAuditEvent(admin, { companyId: invite.company_id, actionType: "invite_expired", moduleName: "access_control", entityType: "invitation", entityId: invite.id, entityReferenceNumber: invite.email, status: "failed", changeSummary: "Invite expired before acceptance" });
      return NextResponse.json({ error: "Invite has expired." }, { status: 400 });
    }

    // app_users.role must be one of the supported base roles: it is enforced by a DB
    // CHECK constraint and is the sole key the authorization layer (can()) understands.
    // Custom role_keys minted via /api/access/roles are not yet enforced by can(), so a
    // role_key outside the base set would (a) violate the CHECK and 500, and (b) leave the
    // user with no effective permissions. Fall back to a safe low-privilege base role and
    // still record the intended role_id on user_roles below for when granular RBAC lands.
    const requestedRoleKey = invite.roles?.role_key ?? "viewer";
    // Own-property check only: `in` would also match inherited keys like "toString",
    // letting an invalid role_key through to the app_users.role CHECK and 500 at insert.
    const roleKey = Object.prototype.hasOwnProperty.call(defaultRolePermissions, requestedRoleKey) ? requestedRoleKey : "viewer";
    const userResult = await getOrCreateInvitedAuthUser(admin, invite.email, parsed.data.password, invite.full_name);
    if (userResult.error || !userResult.userId) return NextResponse.json({ error: userResult.error ?? "Could not create invited user" }, { status: userResult.status ?? 500 });
    const userId = userResult.userId;

    const profilePayload = {
      id: userId,
      company_id: invite.company_id,
      dealer_id: invite.dealer_id,
      branch_id: invite.branch_id,
      full_name: invite.full_name,
      email: invite.email,
      phone: invite.phone,
      role: roleKey,
      is_active: true,
      status: "active",
      invited_by: invite.invited_by,
      invited_at: invite.created_at,
      department: invite.department,
      sales_region: invite.sales_region
    };
    const profileResult = await admin.from("app_users").upsert(profilePayload, { onConflict: "id" });
    if (profileResult.error) return NextResponse.json({ error: getErrorMessage(profileResult.error, "Could not create app user profile") }, { status: 500 });

    if (invite.role_id) {
      const existingRole = await admin
        .from("user_roles")
        .select("id")
        .eq("user_id", userId)
        .eq("role_id", invite.role_id)
        .maybeSingle();
      if (!existingRole.data) {
        await admin.from("user_roles").insert({
          company_id: invite.company_id,
          user_id: userId,
          role_id: invite.role_id,
          dealer_id: invite.dealer_id,
          branch_id: invite.branch_id,
          sales_region: invite.sales_region,
          department: invite.department,
          is_primary: true,
          assigned_by: invite.invited_by
        });
      }
    }

    const acceptanceResult = await admin
      .from("invitations")
      .update({ status: "accepted", accepted_by: userId, accepted_at: new Date().toISOString() })
      .eq("id", invite.id)
      .eq("status", "pending")
      .select("id")
      .single();
    if (acceptanceResult.error || !acceptanceResult.data) return NextResponse.json({ error: "Invite has already been accepted or is no longer pending." }, { status: 409 });
    await admin.from("notifications").insert({
      company_id: invite.company_id,
      dealer_id: invite.dealer_id,
      notification_type: "invite_accepted",
      severity: "success",
      title: "Invite accepted",
      body: `${invite.full_name} accepted their ExtrusionOS invite.`,
      related_entity_type: "app_user",
      related_entity_id: userId,
      entity_reference: invite.email
    });
    await logEnterpriseAuditEvent(admin, {
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
    });

    return NextResponse.json({ ok: true, email: invite.email });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, "Invite acceptance failed") }, { status: 500 });
  }
}

async function getOrCreateInvitedAuthUser(admin: ReturnType<typeof createAdminClient>, email: string, password: string, fullName: string) {
  const createdUser = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName }
  });

  if (createdUser.data.user) return { userId: createdUser.data.user.id };
  const message = getErrorMessage(createdUser.error, "Could not create invited user");
  if (!/already|registered|exists/i.test(message)) return { error: message };

  const existingUser = await findAuthUserByEmail(admin, email);
  if (!existingUser?.id) return { error: "A login already exists for this email, but it could not be safely linked to the invite.", status: 409 };
  return { error: "An account already exists for this email. Sign in with that account, use password reset if needed, and ask an owner/admin to assign access from Users & Roles.", status: 409 };
}

async function findAuthUserByEmail(admin: ReturnType<typeof createAdminClient>, email: string) {
  const targetEmail = email.toLowerCase();
  // Query auth.users directly via the service role client — O(1) indexed lookup
  const { data, error } = await admin
    .from("auth.users" as any)
    .select("id, email, user_metadata")
    .ilike("email", targetEmail)
    .limit(1)
    .maybeSingle();

  if (!error && data) return data;

  // Fallback: use the admin API listUsers with a single-page scan
  // This handles cases where the direct query is blocked by project config
  const result = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (result.error) return null;
  return result.data.users.find((user) => user.email?.toLowerCase() === targetEmail) ?? null;
}
