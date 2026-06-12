import { redirect } from "next/navigation";
import { DataCenterClient } from "@/components/modules/data-center-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";

export default async function DataCenterPage() {
  const context = await getSessionContext();
  if (!can(context.role, "update", "settings")) redirect("/dashboard");

  const supabase = await createClient();
  const [retentionResult, exportJobsResult, logsResult, customersResult, profilesResult, diesResult, quotesResult, ordersResult, invoicesResult, documentsResult] = await Promise.all([
    supabase.from("data_retention_settings").select("*").eq("company_id", context.companyId).maybeSingle(),
    supabase.from("data_exchange_jobs").select("id, module_name, status, created_at, completed_at, error_message").eq("company_id", context.companyId).eq("job_type", "export").order("created_at", { ascending: false }).limit(30),
    supabase.from("audit_logs").select("id, action, entity_type, metadata_json, created_at").eq("company_id", context.companyId).in("action", ["export_company_data", "export_module_csv", "export_document_index", "restore_record", "update_retention"]).order("created_at", { ascending: false }).limit(50),
    supabase.from("customers").select("id, customer_name, company_name, deleted_at").eq("company_id", context.companyId).not("deleted_at", "is", null).order("deleted_at", { ascending: false }).limit(30),
    supabase.from("aluminium_profiles").select("id, profile_code, profile_name, deleted_at").eq("company_id", context.companyId).not("deleted_at", "is", null).order("deleted_at", { ascending: false }).limit(30),
    supabase.from("dies").select("id, die_number, deleted_at").eq("company_id", context.companyId).not("deleted_at", "is", null).order("deleted_at", { ascending: false }).limit(30),
    supabase.from("quotes").select("id, quote_number, deleted_at").eq("company_id", context.companyId).not("deleted_at", "is", null).order("deleted_at", { ascending: false }).limit(30),
    supabase.from("orders").select("id, order_number, deleted_at").eq("company_id", context.companyId).not("deleted_at", "is", null).order("deleted_at", { ascending: false }).limit(30),
    supabase.from("invoices").select("id, invoice_number, deleted_at").eq("company_id", context.companyId).not("deleted_at", "is", null).order("deleted_at", { ascending: false }).limit(30),
    supabase.from("documents").select("id, file_name, document_type, deleted_at").eq("company_id", context.companyId).not("deleted_at", "is", null).order("deleted_at", { ascending: false }).limit(30)
  ]);

  const deletedRecords = [
    ...(customersResult.data ?? []).map((item: any) => ({ table: "customers", id: item.id, label: item.company_name || item.customer_name || "Customer", deleted_at: item.deleted_at })),
    ...(profilesResult.data ?? []).map((item: any) => ({ table: "aluminium_profiles", id: item.id, label: `${item.profile_code || "PR"} - ${item.profile_name || "Profile"}`, deleted_at: item.deleted_at })),
    ...(diesResult.data ?? []).map((item: any) => ({ table: "dies", id: item.id, label: item.die_number || "Die", deleted_at: item.deleted_at })),
    ...(quotesResult.data ?? []).map((item: any) => ({ table: "quotes", id: item.id, label: item.quote_number || "Quote", deleted_at: item.deleted_at })),
    ...(ordersResult.data ?? []).map((item: any) => ({ table: "orders", id: item.id, label: item.order_number || "Order", deleted_at: item.deleted_at })),
    ...(invoicesResult.data ?? []).map((item: any) => ({ table: "invoices", id: item.id, label: item.invoice_number || "Invoice", deleted_at: item.deleted_at })),
    ...(documentsResult.data ?? []).map((item: any) => ({ table: "documents", id: item.id, label: item.file_name || item.document_type || "Document", deleted_at: item.deleted_at }))
  ].sort((a, b) => new Date(b.deleted_at || 0).getTime() - new Date(a.deleted_at || 0).getTime());

  return <DataCenterClient companyId={context.companyId} userId={context.userId} retention={retentionResult.data} exportJobs={(exportJobsResult.data ?? []) as any[]} activityLogs={(logsResult.data ?? []) as any[]} deletedRecords={deletedRecords as any[]} />;
}
