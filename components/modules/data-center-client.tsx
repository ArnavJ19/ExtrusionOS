"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ArchiveRestore, Download, FileArchive, History, ShieldCheck, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/browser";
import { formatDate } from "@/lib/utils/format";
import { dataRetentionSettingsSchema } from "@/lib/validations/schemas";

type DeletedRecord = { table: string; id: string; label: string; deleted_at: string | null };
type ExportJob = { id: string; module_name: string; status: string; created_at: string; completed_at: string | null; error_message: string | null };
type ActivityLog = { id: string; action: string; entity_type: string; metadata_json: Record<string, any>; created_at: string };

type Props = {
  companyId: string;
  userId: string;
  retention: Record<string, any> | null;
  exportJobs: ExportJob[];
  activityLogs: ActivityLog[];
  deletedRecords: DeletedRecord[];
};

const moduleTables: Record<string, string> = {
  customers: "customers",
  profiles: "aluminium_profiles",
  dies: "dies",
  quotes: "quotes",
  orders: "orders",
  invoices: "invoices",
  documents: "documents"
};

export function DataCenterClient({ companyId, userId, retention, exportJobs, activityLogs, deletedRecords }: Props) {
  const supabase = createClient();
  const [retentionForm, setRetentionForm] = useState({
    soft_delete_retention_days: retention?.soft_delete_retention_days ?? 90,
    export_retention_days: retention?.export_retention_days ?? 180,
    audit_log_retention_days: retention?.audit_log_retention_days ?? 365,
    auto_purge_enabled: false
  });
  const [deleted, setDeleted] = useState(deletedRecords);
  const [logs, setLogs] = useState(activityLogs);

  const deletedByTable = useMemo(() => {
    const map: Record<string, number> = {};
    for (const item of deleted) map[item.table] = (map[item.table] ?? 0) + 1;
    return map;
  }, [deleted]);

  function downloadBlob(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function toCsv(rows: Record<string, unknown>[]) {
    if (!rows.length) return "";
    const headers = Object.keys(rows[0]);
    const escape = (value: unknown) => {
      const text = String(value ?? "");
      if (text.includes(",") || text.includes('"') || text.includes("\n")) return `"${text.replace(/"/g, '""')}"`;
      return text;
    };
    const lines = [headers.join(",")];
    for (const row of rows) lines.push(headers.map((header) => escape(row[header])).join(","));
    return lines.join("\n");
  }

  async function writeAudit(action: string, entityType: string, metadata: Record<string, any>) {
    const insert = await supabase.from("audit_logs").insert({
      company_id: companyId,
      actor_id: userId,
      action,
      entity_type: entityType,
      metadata_json: metadata
    }).select("id, action, entity_type, metadata_json, created_at").single();
    if (!insert.error && insert.data) setLogs((current) => [insert.data as ActivityLog, ...current]);
  }

  async function exportCompanyData() {
    try {
      const tables = ["customers", "aluminium_profiles", "dies", "quotes", "orders", "invoices", "documents"];
      const payload: Record<string, unknown> = { exported_at: new Date().toISOString(), company_id: companyId, data: {} };

      for (const table of tables) {
        const result = await supabase.from(table).select("*").eq("company_id", companyId).limit(500);
        if (!result.error) payload.data = { ...(payload.data as Record<string, unknown>), [table]: result.data ?? [] };
      }

      downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), `company-data-${new Date().toISOString().slice(0, 10)}.json`);
      await writeAudit("export_company_data", "backup", { mode: "json", modules: Object.keys((payload.data as Record<string, unknown>) || {}) });
      toast.success("Company data export downloaded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export failed");
    }
  }

  async function exportModuleCsv(moduleName: string) {
    const table = moduleTables[moduleName];
    if (!table) return;
    const result = await supabase.from(table).select("*").eq("company_id", companyId).limit(1000);
    if (result.error) return toast.error(result.error.message || "Could not export module CSV");
    const csv = toCsv((result.data ?? []) as Record<string, unknown>[]);
    downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${moduleName}-${new Date().toISOString().slice(0, 10)}.csv`);
    await writeAudit("export_module_csv", moduleName, { table, rows: result.data?.length ?? 0 });
    toast.success(`${moduleName} CSV downloaded`);
  }

  async function exportDocumentIndex() {
    const result = await supabase.from("documents").select("id, document_type, file_name, file_url, related_entity_type, related_entity_id, created_at").eq("company_id", companyId).limit(2000);
    if (result.error) return toast.error(result.error.message || "Could not download document index");
    const csv = toCsv((result.data ?? []) as Record<string, unknown>[]);
    downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `document-index-${new Date().toISOString().slice(0, 10)}.csv`);
    await writeAudit("export_document_index", "documents", { rows: result.data?.length ?? 0 });
    toast.success("Document index downloaded");
  }

  async function saveRetentionSettings() {
    const parsed = dataRetentionSettingsSchema.safeParse({ ...retentionForm, auto_purge_enabled: false });
    if (!parsed.success) return toast.error(parsed.error.issues[0]?.message ?? "Invalid retention settings");
    const result = await supabase.from("data_retention_settings").upsert({ company_id: companyId, ...parsed.data }).select().single();
    if (result.error) return toast.error(result.error.message || "Could not save retention settings");
    await writeAudit("update_retention", "data_retention_settings", parsed.data);
    toast.success("Retention settings saved");
  }

  async function restoreRecord(record: DeletedRecord) {
    const patch: Record<string, unknown> = { deleted_at: null, deleted_by: null };
    if (["customers", "aluminium_profiles"].includes(record.table)) patch.is_active = true;
    const result = await supabase.from(record.table).update(patch).eq("id", record.id).eq("company_id", companyId);
    if (result.error) return toast.error(result.error.message || "Could not restore record");
    setDeleted((current) => current.filter((item) => !(item.table === record.table && item.id === record.id)));
    await writeAudit("restore_record", record.table, { id: record.id, label: record.label });
    toast.success("Record restored");
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Data Backup and Recovery" description="Export company/module data, configure retention, recover soft-deleted business records, and review backup activity." actions={<Button onClick={exportCompanyData}><Download className="h-4 w-4" /> Export company data</Button>} />

      <div className="grid gap-4 md:grid-cols-4">
        <Stat label="Deleted Records" value={deleted.length.toString()} icon={Trash2} />
        <Stat label="Export Jobs" value={exportJobs.length.toString()} icon={FileArchive} />
        <Stat label="Activity Logs" value={logs.length.toString()} icon={History} />
        <Stat label="Auto Purge" value="Manual" icon={ShieldCheck} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader><h2 className="section-title">Module-wise CSV Export</h2></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {Object.keys(moduleTables).map((moduleName) => <button key={moduleName} onClick={() => exportModuleCsv(moduleName)} className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-orange/60"><p className="font-black text-slate-950">{moduleName.replace(/_/g, " ")}</p><p className="mt-1 text-xs font-bold text-slate-500">{deletedByTable[moduleTables[moduleName]] ? `${deletedByTable[moduleTables[moduleName]]} deleted` : "No deleted"}</p></button>)}
            <button onClick={exportDocumentIndex} className="rounded-2xl border border-orange/20 bg-orange/5 p-4 text-left shadow-sm transition hover:border-orange"><p className="font-black text-slate-950">Download document index</p><p className="mt-1 text-xs font-bold text-slate-500">File name, URL, entity mapping</p></button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><h2 className="section-title">Retention Settings</h2></CardHeader>
          <CardContent className="space-y-4">
            <label className="block space-y-1.5"><span className="form-label">Soft-delete retention days</span><input type="number" className="form-input" value={retentionForm.soft_delete_retention_days} onChange={(event) => setRetentionForm({ ...retentionForm, soft_delete_retention_days: Number(event.target.value || 0) })} /></label>
            <label className="block space-y-1.5"><span className="form-label">Export retention days</span><input type="number" className="form-input" value={retentionForm.export_retention_days} onChange={(event) => setRetentionForm({ ...retentionForm, export_retention_days: Number(event.target.value || 0) })} /></label>
            <label className="block space-y-1.5"><span className="form-label">Audit log retention days</span><input type="number" className="form-input" value={retentionForm.audit_log_retention_days} onChange={(event) => setRetentionForm({ ...retentionForm, audit_log_retention_days: Number(event.target.value || 0) })} /></label>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium leading-6 text-amber-900">
              <p className="font-black">Automatic purge is not scheduled</p>
              <p className="mt-1">Retention windows are saved for policy tracking, but record deletion remains manual until a reviewed server-side purge job exists.</p>
            </div>
            <Button onClick={saveRetentionSettings}>Save retention settings</Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardHeader><h2 className="section-title">Soft-delete Recovery</h2></CardHeader>
          <CardContent className="space-y-3">
            {deleted.length ? deleted.map((record) => (
              <div key={`${record.table}:${record.id}`} className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-black text-slate-950">{record.label}</p><p className="text-sm font-medium text-slate-500">{record.table.replace(/_/g, " ")} · deleted {formatDate(record.deleted_at)}</p></div><div className="flex gap-2"><Badge value="soft_deleted" /><Button variant="secondary" onClick={() => restoreRecord(record)}><ArchiveRestore className="h-4 w-4" /> Restore</Button></div></div>
              </div>
            )) : <div className="empty-mini">No soft-deleted records pending recovery.</div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><h2 className="section-title">Backup Activity Log</h2></CardHeader>
          <CardContent className="space-y-3">
            {logs.length ? logs.map((log) => (
              <div key={log.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-black text-slate-950">{log.action.replace(/_/g, " ")}</p><Badge value={log.entity_type} /></div>
                <p className="mt-1 text-xs font-bold text-slate-500">{formatDate(log.created_at)}</p>
                <p className="mt-2 text-xs font-medium text-slate-600">{Object.keys(log.metadata_json || {}).length ? JSON.stringify(log.metadata_json) : "No metadata"}</p>
              </div>
            )) : <div className="empty-mini">No activity log entries yet.</div>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><h2 className="section-title">Recent Export Jobs</h2></CardHeader>
        <CardContent className="space-y-3">
          {exportJobs.length ? exportJobs.map((job) => (
            <div key={job.id} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-black text-slate-950">{job.module_name.replace(/_/g, " ")}</p><Badge value={job.status} /></div>
              <p className="mt-1 text-xs font-bold text-slate-500">Started {formatDate(job.created_at)}{job.completed_at ? ` · Completed ${formatDate(job.completed_at)}` : ""}</p>
              {job.error_message ? <p className="mt-2 text-xs font-bold text-red-700">{job.error_message}</p> : null}
            </div>
          )) : <div className="empty-mini">No export jobs recorded yet.</div>}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Trash2 }) {
  return <div className="metric-card"><Icon className="relative z-[1] h-5 w-5 text-orange" /><p className="relative z-[1] mt-3 text-xs font-black uppercase tracking-[0.14em] text-slate-500">{label}</p><p className="relative z-[1] mt-2 text-2xl font-black text-slate-950">{value}</p></div>;
}
