import { redirect } from "next/navigation";
import { IntegrationsClient } from "@/components/modules/integrations-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";

export default async function IntegrationsPage() {
  const context = await getSessionContext();
  if (!can(context.role, "update", "settings")) redirect("/dashboard");

  const supabase = await createClient();
  const [integrationsResult, logsResult] = await Promise.all([
    supabase
      .from("integrations")
      .select("id, integration_type, provider_name, status, config_json, secret_reference, last_sync_at")
      .eq("company_id", context.companyId)
      .order("provider_name", { ascending: true }),
    supabase
      .from("sync_logs")
      .select("id, sync_type, status, records_processed, records_failed, error_message, started_at, completed_at, integrations(provider_name)")
      .eq("company_id", context.companyId)
      .order("started_at", { ascending: false })
      .limit(50)
  ]);

  const syncLogs = (logsResult.data ?? []).map((log: any) => ({
    id: log.id,
    provider_name: log.integrations?.provider_name ?? "Integration job",
    sync_type: log.sync_type,
    status: log.status,
    records_processed: log.records_processed,
    records_failed: log.records_failed,
    error_message: log.error_message,
    started_at: log.started_at,
    completed_at: log.completed_at
  }));

  return <IntegrationsClient integrations={(integrationsResult.data ?? []) as any[]} syncLogs={syncLogs as any[]} />;
}
