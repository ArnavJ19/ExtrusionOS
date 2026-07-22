import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { logEnterpriseAuditEvent } from "@/lib/enterprise/audit";
import { createClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils/errors";
import { recordsToCsv } from "@/lib/utils/csv";

const columns = ["timestamp", "actor_name", "actor_role", "action_type", "module_name", "entity_type", "entity_reference_number", "change_summary", "status", "ip_address"];

export async function GET() {
  try {
    const context = await getSessionContext();
    if (!can(context.role, "read", "audit_logs") || !can(context.role, "create", "reports")) return NextResponse.json({ error: "You do not have permission to export audit logs." }, { status: 403 });
    const supabase = await createClient();
    const result = await supabase.from("audit_logs_enterprise").select(columns.join(",")).eq("company_id", context.companyId).order("timestamp", { ascending: false }).limit(5000);
    if (result.error) return NextResponse.json({ error: getErrorMessage(result.error, "Could not export audit logs") }, { status: 500 });
    await supabase.from("report_exports").insert({ company_id: context.companyId, report_type: "audit_logs", exported_by: context.userId, status: "completed" });
    await logEnterpriseAuditEvent(supabase, { companyId: context.companyId, actorUserId: context.userId, actorName: context.fullName ?? context.email, actorRole: context.role, actorDealerId: context.dealerId, actionType: "report_exported", moduleName: "reports", entityType: "audit_logs", changeSummary: "Audit logs exported to CSV" });
    return new Response(recordsToCsv(columns, (result.data ?? []) as unknown as Record<string, unknown>[]), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=audit-logs.csv" } });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, "Audit export failed") }, { status: 500 });
  }
}
