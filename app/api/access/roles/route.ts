import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { logEnterpriseAuditEvent } from "@/lib/enterprise/audit";
import { createClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils/errors";

const roleSchema = z.object({
  name: z.string().min(2),
  role_key: z.string().min(2).regex(/^[a-z0-9_]+$/),
  description: z.string().optional(),
  permissions: z.array(z.string()).default([])
});

export async function POST(request: Request) {
  try {
    const context = await getSessionContext();
    if (!can(context.role, "create", "roles")) return NextResponse.json({ error: "You do not have permission to manage roles." }, { status: 403 });
    const parsed = roleSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid role" }, { status: 400 });

    const supabase = await createClient();
    const roleResult = await supabase.from("roles").insert({
      company_id: context.companyId,
      role_key: parsed.data.role_key,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      is_system: false,
      created_by: context.userId
    }).select("id, role_key, name").single();
    if (roleResult.error || !roleResult.data) return NextResponse.json({ error: getErrorMessage(roleResult.error, "Could not create role") }, { status: 500 });

    if (parsed.data.permissions.length) {
      const permissionRows = parsed.data.permissions.map((permission_key) => ({ role_id: roleResult.data.id, permission_key, granted_by: context.userId }));
      const permissionResult = await supabase.from("role_permissions").insert(permissionRows);
      if (permissionResult.error) return NextResponse.json({ error: getErrorMessage(permissionResult.error, "Could not assign permissions") }, { status: 500 });
    }

    await logEnterpriseAuditEvent(supabase, {
      companyId: context.companyId,
      actorUserId: context.userId,
      actorName: context.fullName ?? context.email,
      actorRole: context.role,
      actorDealerId: context.dealerId,
      actionType: "role_created",
      moduleName: "access_control",
      entityType: "role",
      entityId: roleResult.data.id,
      entityReferenceNumber: roleResult.data.role_key,
      newValue: parsed.data,
      changeSummary: `Role ${parsed.data.name} created`
    });

    return NextResponse.json({ role: roleResult.data });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, "Role creation failed") }, { status: 500 });
  }
}
