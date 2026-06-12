import { AlertTriangle, CheckCircle2, Clock, FileText, Gauge, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils/format";

const STATUS_COLORS: Record<string, string> = {
  valid: "bg-green-100 text-green-800",
  due_soon: "bg-amber-100 text-amber-800",
  overdue: "bg-red-100 text-red-800",
  expired: "bg-red-100 text-red-800",
  scheduled: "bg-blue-100 text-blue-800",
  in_progress: "bg-indigo-100 text-indigo-800",
  completed: "bg-green-100 text-green-800",
  non_conformance: "bg-red-100 text-red-800",
  closed: "bg-slate-100 text-slate-700"
};

export default async function CompliancePage() {
  const context = await getSessionContext();
  const supabase = await createClient();
  const [standardsResult, calibrationsResult, auditsResult] = await Promise.all([
    supabase.from("compliance_standards").select("id, standard_code, standard_name, product_category, is_applicable").eq("company_id", context.companyId).order("standard_code").limit(200),
    supabase.from("calibration_records").select("id, equipment_name, equipment_id_code, calibration_date, next_due_date, calibrated_by, status").eq("company_id", context.companyId).order("next_due_date").limit(100),
    supabase.from("compliance_audit_records").select("id, audit_name, audit_type, audit_date, auditor_name, status, findings, corrective_actions").eq("company_id", context.companyId).order("audit_date", { ascending: false }).limit(100)
  ]);

  const standards = standardsResult.data ?? [];
  const calibrations = calibrationsResult.data ?? [];
  const audits = auditsResult.data ?? [];
  const calValid = calibrations.filter((item) => item.status === "valid").length;
  const calDueSoon = calibrations.filter((item) => item.status === "due_soon").length;
  const calOverdue = calibrations.filter((item) => item.status === "overdue").length;
  const readiness = readinessScore(standards, calibrations, audits);

  return (
    <div className="space-y-6">
      <PageHeader title="BIS/QCO Compliance Center" description="Tenant-scoped standards library, calibration records, audit records, and compliance readiness." />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Metric label="Audit Readiness" value={`${readiness}%`} icon={Gauge} tone={readiness >= 80 ? "green" : "amber"} />
        <Metric label="Standards" value={String(standards.filter((item) => item.is_applicable).length)} icon={FileText} tone="blue" />
        <Metric label="Cal. Valid" value={String(calValid)} icon={CheckCircle2} tone="green" />
        <Metric label="Cal. Due Soon" value={String(calDueSoon)} icon={Clock} tone="amber" />
        <Metric label="Cal. Overdue" value={String(calOverdue)} icon={AlertTriangle} tone="red" />
      </div>

      <Card>
        <CardContent className="p-0">
          <SectionTitle title="Standards" />
          {standards.length ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b bg-slate-50">{["Code", "Standard Name", "Category", "Status"].map((heading) => <th key={heading} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">{heading}</th>)}</tr></thead><tbody>{standards.map((standard) => <tr key={standard.id} className="border-b last:border-0"><td className="px-4 py-3 font-mono font-bold text-slate-900">{standard.standard_code}</td><td className="px-4 py-3 text-slate-700">{standard.standard_name}</td><td className="px-4 py-3"><Badge value={standard.product_category} /></td><td className="px-4 py-3"><Badge value={standard.is_applicable ? "Applicable" : "Not applicable"} className={standard.is_applicable ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-400"} /></td></tr>)}</tbody></table></div> : <div className="p-4"><EmptyState title="No standards recorded" description="Add compliance standards before using BIS/QCO readiness tracking." /></div>}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          <SectionTitle title="Calibration Records" />
          {calibrations.length ? calibrations.map((record) => <div key={record.id} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4"><div><div className="mb-1 flex items-center gap-2"><span className="font-mono text-[10px] font-bold text-slate-500">{record.equipment_id_code}</span><Badge value={record.status} className={STATUS_COLORS[record.status] ?? STATUS_COLORS.valid} /></div><p className="text-sm font-black text-slate-900">{record.equipment_name}</p><p className="mt-0.5 text-xs text-slate-500">Calibrated: {formatDate(record.calibration_date)} · By: {record.calibrated_by || "Not captured"}</p></div><div className="text-right"><p className="text-[10px] font-bold uppercase text-slate-500">Next Due</p><p className="text-sm font-black text-slate-900">{formatDate(record.next_due_date)}</p></div></div>) : <EmptyState title="No calibration records" description="Calibration records appear here after QC equipment is registered." />}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          <SectionTitle title="Audit Records" />
          {audits.length ? audits.map((audit) => <div key={audit.id} className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex items-start justify-between gap-3"><div><div className="mb-1 flex items-center gap-2"><Badge value={audit.audit_type} /><Badge value={audit.status} className={STATUS_COLORS[audit.status] ?? STATUS_COLORS.scheduled} /></div><p className="text-sm font-black text-slate-900">{audit.audit_name}</p><p className="mt-0.5 text-xs text-slate-500">Auditor: {audit.auditor_name || "Not captured"} · Date: {formatDate(audit.audit_date)}</p></div><ShieldCheck className={`h-5 w-5 shrink-0 ${["completed", "closed"].includes(audit.status) ? "text-green-500" : audit.status === "non_conformance" ? "text-red-500" : "text-slate-300"}`} /></div>{audit.findings ? <p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs font-medium text-slate-700">{audit.findings}</p> : null}</div>) : <EmptyState title="No audit records" description="BIS, ISO, customer, and internal audit records appear here once recorded." />}
        </CardContent>
      </Card>
    </div>
  );
}

function readinessScore(standards: any[], calibrations: any[], audits: any[]) {
  const parts = [
    standards.length ? standards.filter((item) => item.is_applicable).length / standards.length : 0,
    calibrations.length ? calibrations.filter((item) => item.status === "valid").length / calibrations.length : 0,
    audits.length ? audits.filter((item) => ["completed", "closed"].includes(item.status)).length / audits.length : 0
  ];
  return Math.round((parts.reduce((sum, part) => sum + part, 0) / parts.length) * 100);
}

function SectionTitle({ title }: { title: string }) {
  return <h2 className="px-4 py-3 text-sm font-black uppercase tracking-[0.12em] text-slate-500">{title}</h2>;
}

function Metric({ label, value, icon: Icon, tone }: { label: string; value: string; icon: typeof Gauge; tone: "green" | "amber" | "blue" | "red" }) {
  const tones = { green: "bg-green-50 text-green-600", amber: "bg-amber-50 text-amber-600", blue: "bg-blue-50 text-blue-600", red: "bg-red-50 text-red-600" };
  return <Card><CardContent className="p-4"><div className="mb-1 flex items-center gap-2"><div className={`flex h-7 w-7 items-center justify-center rounded-lg ${tones[tone]}`}><Icon className="h-3.5 w-3.5" /></div><p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p></div><p className="mt-1 text-xl font-black text-slate-900">{value}</p></CardContent></Card>;
}

function Badge({ value, className = "bg-slate-100 text-slate-700" }: { value: string; className?: string }) {
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${className}`}>{String(value ?? "-").replace(/_/g, " ")}</span>;
}
