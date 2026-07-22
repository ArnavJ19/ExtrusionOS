"use client";

import { useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, DatabaseZap, Download, FileSpreadsheet, KeyRound, Mail, MessageSquare, PlugZap, Upload } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/lib/utils/format";

type Integration = {
  id: string;
  integration_type: string;
  provider_name: string;
  status: "not_configured" | "connected" | "error" | "disabled";
  last_sync_at: string | null;
  config_json: Record<string, unknown>;
  secret_reference: string | null;
};

type SyncLog = {
  id: string;
  provider_name: string;
  sync_type: string;
  status: "queued" | "running" | "completed" | "failed" | "partial";
  records_processed: number;
  records_failed: number;
  error_message?: string | null;
  started_at: string;
  completed_at?: string | null;
};

type Props = {
  integrations: Integration[];
  syncLogs: SyncLog[];
};

const statusClass: Record<Integration["status"] | SyncLog["status"], string> = {
  not_configured: "bg-slate-100 text-slate-700",
  connected: "bg-emerald-100 text-emerald-800",
  error: "bg-red-100 text-red-800",
  disabled: "bg-slate-200 text-slate-500",
  queued: "bg-blue-100 text-blue-800",
  running: "bg-orange/10 text-orange",
  completed: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
  partial: "bg-amber-100 text-amber-800"
};

const iconByType: Record<string, typeof PlugZap> = {
  tally: FileSpreadsheet,
  busy: FileSpreadsheet,
  zoho_books: DatabaseZap,
  whatsapp_business: MessageSquare,
  email_smtp: Mail,
  indiamart_leads: Download,
  tradeindia_leads: Download,
  google_drive_backup: Upload,
  google_sheets_export: FileSpreadsheet,
  payment_gateway: KeyRound,
  broker_transport_api: PlugZap
};

function isManualBridge(integration: Integration) {
  return String(integration.config_json?.mode ?? integration.config_json?.bridge ?? "").toLowerCase().includes("manual");
}

export function IntegrationsClient({ integrations, syncLogs }: Props) {
  const [selectedType, setSelectedType] = useState("all");
  const filtered = useMemo(() => selectedType === "all" ? integrations : integrations.filter((item) => item.integration_type === selectedType), [integrations, selectedType]);
  const connected = integrations.filter((item) => item.status === "connected" && !isManualBridge(item)).length;
  const errors = integrations.filter((item) => item.status === "error").length;
  const manualBridgeCount = integrations.filter(isManualBridge).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Integration Layer"
        description="Review configured accounting, WhatsApp, email, lead-source, backup, and reporting bridges without exposing secrets in the browser."
      />

      <div className="grid gap-4 md:grid-cols-4">
        <Metric icon={CheckCircle2} label="Connected" value={connected.toString()} />
        <Metric icon={AlertCircle} label="Errors" value={errors.toString()} />
        <Metric icon={Upload} label="Manual Bridges" value={manualBridgeCount.toString()} />
        <Metric icon={KeyRound} label="Server Secrets" value={integrations.filter((item) => item.secret_reference).length.toString()} />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="section-title">Provider Registry</h2>
            {integrations.length ? (
              <div className="flex flex-wrap gap-2">
                {["all", ...integrations.map((item) => item.integration_type)].filter((value, index, all) => all.indexOf(value) === index).map((type) => <button key={type} onClick={() => setSelectedType(type)} className={`rounded-full px-3 py-1.5 text-xs font-black capitalize transition ${selectedType === type ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{type.replace(/_/g, " ")}</button>)}
              </div>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 xl:grid-cols-2">
          {filtered.length ? filtered.map((integration) => <IntegrationCard key={integration.id} integration={integration} />) : <div className="xl:col-span-2"><EmptyState title="No integrations configured" description="Add integration records through a reviewed server-side setup flow before exposing sync actions here." /></div>}
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
        <Card>
          <CardHeader><h2 className="section-title">Secure Configuration</h2></CardHeader>
          <CardContent className="space-y-3 text-sm font-medium leading-6 text-slate-700">
            <p className="rounded-2xl border border-slate-200 bg-white p-4">`config_json` stores non-secret mapping settings only: voucher type, ledger mapping, branch code, template name, sheet name, or import field map.</p>
            <p className="rounded-2xl border border-orange/20 bg-orange/5 p-4">API tokens, OAuth client secrets, SMTP passwords, and webhook signing secrets must live in server environment variables or a managed secret store. The database keeps only `secret_reference`.</p>
            <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">Sync and import/export buttons are hidden until a configured provider exposes a reviewed server action.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><h2 className="section-title">Sync Logs</h2></CardHeader>
          <CardContent className="space-y-3">
            {syncLogs.length ? syncLogs.map((log) => (
              <div key={log.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div><p className="font-black text-slate-950">{log.provider_name}</p><p className="text-sm font-medium text-slate-500">{log.sync_type.replace(/_/g, " ")} - {formatDate(log.started_at)}</p></div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-black capitalize ${statusClass[log.status]}`}>{log.status}</span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm"><Info label="Processed" value={log.records_processed.toString()} /><Info label="Failed" value={log.records_failed.toString()} /></div>
                {log.error_message ? <p className="mt-3 rounded-xl bg-red-50 p-3 text-xs font-bold text-red-800">{log.error_message}</p> : null}
              </div>
            )) : <EmptyState title="No sync logs yet" description="Provider runs will appear here after a real integration job executes." />}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><h2 className="section-title">Provider Interfaces</h2></CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-3">
          <InterfaceBlock title="AccountingProvider" methods={["exportInvoice()", "exportCustomer()", "exportPayment()", "importLedgerBalance()"]} />
          <InterfaceBlock title="LeadProvider" methods={["importLeads()", "mapLeadFields()"]} />
          <InterfaceBlock title="CommunicationProvider" methods={["sendMessage()", "checkStatus()"]} />
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof PlugZap; label: string; value: string }) {
  return <div className="metric-card"><Icon className="relative z-[1] h-5 w-5 text-orange" /><p className="relative z-[1] mt-3 text-xs font-black uppercase tracking-[0.14em] text-slate-500">{label}</p><p className="relative z-[1] mt-2 text-2xl font-black text-slate-950">{value}</p></div>;
}

function IntegrationCard({ integration }: { integration: Integration }) {
  const Icon = iconByType[integration.integration_type] ?? PlugZap;
  const summary = String(integration.config_json?.summary ?? integration.config_json?.description ?? "No non-secret configuration summary recorded.");
  const manualOnly = isManualBridge(integration);
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3"><div className="rounded-2xl bg-aluminium p-3"><Icon className="h-5 w-5 text-orange" /></div><div><p className="font-black text-slate-950">{integration.provider_name}</p><p className="text-sm font-medium capitalize text-slate-500">{integration.integration_type.replace(/_/g, " ")}</p></div></div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-black capitalize ${manualOnly ? "bg-amber-100 text-amber-800" : statusClass[integration.status]}`}>{manualOnly ? "manual only" : integration.status.replace(/_/g, " ")}</span>
      </div>
      <p className="mt-4 text-sm font-medium leading-6 text-slate-700">{summary}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2"><Info label="Last Sync" value={formatDate(integration.last_sync_at)} /><Info label="Secret Ref" value={integration.secret_reference || "Not required"} /></div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">{label}</p><p className="mt-1 break-words text-xs font-black text-slate-900">{value}</p></div>;
}

function InterfaceBlock({ title, methods }: { title: string; methods: string[] }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="font-black text-slate-950">{title}</p><div className="mt-3 space-y-2">{methods.map((method) => <code key={method} className="block rounded-xl bg-slate-950 px-3 py-2 text-xs font-bold text-white">{method}</code>)}</div></div>;
}
