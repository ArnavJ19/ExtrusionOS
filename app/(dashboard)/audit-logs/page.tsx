import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { QueryErrorNotice } from "@/components/ui/query-error-notice";
import { can } from "@/lib/auth/permissions";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils/format";
import { getErrorMessage } from "@/lib/utils/errors";

export default async function AuditLogsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const context = await getSessionContext();
  if (!can(context.role, "read", "audit_logs")) redirect("/dashboard");
  const params = await searchParams;
  const supabase = await createClient();
  let query = supabase.from("audit_logs_enterprise").select("*").eq("company_id", context.companyId).order("timestamp", { ascending: false }).limit(100);
  if (params.module) query = query.eq("module_name", params.module);
  if (params.action) query = query.eq("action_type", params.action);
  if (params.status) query = query.eq("status", params.status);
  if (params.q) query = query.or(`entity_reference_number.ilike.%${params.q}%,change_summary.ilike.%${params.q}%,actor_name.ilike.%${params.q}%`);
  const result = await query;

  return (
    <div>
      <PageHeader title="Audit Logs" description="Append-only activity trail for access, quotes, orders, dealer inventory, shipment receipt, recounts, and sensitive changes." actions={<a className="rounded-2xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold shadow-sm" href="/api/reports/audit-logs/export">Export CSV</a>} />
      <QueryErrorNotice messages={result.error ? [getErrorMessage(result.error)] : []} />
      <Card>
        <CardContent>
          <div className="overflow-x-auto"><table className="industrial-table min-w-[1040px]"><thead><tr>{["Time", "User", "Role", "Action", "Module", "Entity", "Summary", "Status"].map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{(result.data ?? []).map((log) => <tr key={log.id}><td>{formatDate(log.timestamp)}</td><td><div className="flex flex-col"><span>{log.actor_name ?? "System"}</span>{log.actor_organization_type === "dealer" ? <span className="text-xs text-neutral-500">Dealer User</span> : null}</div></td><td>{log.actor_role ?? "-"}</td><td><Badge value={log.action_type} /></td><td>{log.module_name}</td><td>{log.entity_reference_number ?? log.entity_id ?? log.entity_type}</td><td className="max-w-md"><div className="truncate">{log.change_summary ?? "-"}</div>{log.description ? <div className="text-xs text-neutral-500 mt-1 truncate">{log.description}</div> : null}</td><td><Badge value={log.status} /></td></tr>)}{!result.data?.length ? <tr><td colSpan={8} className="px-4 py-12 text-center font-semibold text-neutral-500">No audit logs found.</td></tr> : null}</tbody></table></div>
        </CardContent>
      </Card>
    </div>
  );
}
