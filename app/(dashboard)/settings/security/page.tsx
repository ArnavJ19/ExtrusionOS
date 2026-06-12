import { PageHeader } from "@/components/layout/page-header";
import { QueryErrorNotice } from "@/components/ui/query-error-notice";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { getErrorMessage } from "@/lib/utils/errors";
import { SecurityCenterClient } from "@/components/modules/security-center-client";
import { redirect } from "next/navigation";

export default async function SecurityPage() {
  const context = await getSessionContext();
  if (!["owner", "admin"].includes(context.role)) redirect("/dashboard");

  const supabase = await createClient();

  const [loginEventsResult, sensitiveActionsResult, auditLogsResult, roleChangesResult, userSessionsResult, userDirectoryResult] = await Promise.all([
    supabase
      .from("login_events")
      .select("*")
      .eq("company_id", context.companyId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("sensitive_action_logs")
      .select("*")
      .eq("company_id", context.companyId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("audit_logs")
      .select("*")
      .eq("company_id", context.companyId)
      .in("action", ["role_change", "settings_change", "user_deactivated", "user_activated", "data_export", "role_escalation"])
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("audit_logs")
      .select("*")
      .eq("company_id", context.companyId)
      .eq("action", "role_change")
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("app_users")
      .select("id, full_name, email, role, is_active, created_at, updated_at")
      .eq("company_id", context.companyId)
      .order("updated_at", { ascending: false })
      .limit(50),
    supabase
      .from("app_users")
      .select("id, full_name, email")
      .eq("company_id", context.companyId)
      .limit(500)
  ]);

  const userDirectory = (userDirectoryResult.data ?? []).reduce<Record<string, { full_name: string | null; email: string | null }>>((acc, user) => {
    acc[user.id] = { full_name: user.full_name, email: user.email };
    return acc;
  }, {});

  const loginEvents = (loginEventsResult.data ?? []).map((row) => ({
    ...row,
    app_user: row.user_id ? userDirectory[row.user_id] ?? null : null,
  }));

  const sensitiveActions = (sensitiveActionsResult.data ?? []).map((row) => ({
    ...row,
    app_user: row.user_id ? userDirectory[row.user_id] ?? null : null,
  }));

  const roleChanges = (roleChangesResult.data ?? []).map((row) => ({
    ...row,
    app_user: row.actor_id ? userDirectory[row.actor_id] ?? null : null,
  }));

  const queryErrors = [loginEventsResult, sensitiveActionsResult, auditLogsResult, roleChangesResult, userSessionsResult, userDirectoryResult]
    .map((r) => (r.error ? getErrorMessage(r.error) : ""))
    .filter(Boolean);

  return (
    <div>
      <PageHeader
        title="Security Center"
        description="Login history, role changes, sensitive action logs, and data access audit for your company."
      />
      <QueryErrorNotice messages={queryErrors} />
      <SecurityCenterClient
        loginEvents={loginEvents}
        sensitiveActions={sensitiveActions}
        auditLogs={auditLogsResult.data ?? []}
        roleChanges={roleChanges}
        userSessions={userSessionsResult.data ?? []}
      />
    </div>
  );
}
