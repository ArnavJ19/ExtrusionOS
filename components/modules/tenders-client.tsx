"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Calendar, CheckCircle2, Clock, ExternalLink, Landmark, Plus, Search, Trophy, X } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { createTenderAction, type TenderFormInput } from "@/lib/actions/tenders";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { labelize } from "@/types/app";

type Tender = {
  id: string;
  tender_number: string;
  tender_title: string;
  issuing_authority: string;
  sector: string;
  tender_url: string | null;
  publish_date: string | null;
  submission_deadline: string;
  estimated_value: number;
  emd_amount: number;
  emd_status: string;
  document_fee: number;
  bid_value: number;
  status: string;
  technical_status: string;
  commercial_status: string;
  competitor_notes: string | null;
  assigned_to: string | null;
  result_date: string | null;
  converted_order_id: string | null;
  notes: string | null;
  created_at: string;
};

const sectors = ["railways", "airport", "solar", "power", "defence", "metro", "government_building", "infrastructure", "industrial", "other"] as const;
const statuses = ["identified", "under_review", "eligible", "not_eligible", "documents_pending", "submitted", "technically_qualified", "commercially_opened", "won", "lost", "cancelled"];

const emptyForm: TenderFormInput = {
  tender_number: "",
  tender_title: "",
  issuing_authority: "",
  sector: "industrial",
  tender_url: "",
  publish_date: "",
  submission_deadline: "",
  estimated_value: 0,
  emd_amount: 0,
  emd_status: "not_paid",
  document_fee: 0,
  bid_value: 0,
  status: "identified",
  technical_status: "pending",
  commercial_status: "pending",
  competitor_notes: "",
  assigned_to: "",
  result_date: "",
  notes: ""
};

const statusClass: Record<string, string> = {
  identified: "bg-slate-100 text-slate-700",
  under_review: "bg-blue-100 text-blue-800",
  eligible: "bg-emerald-100 text-emerald-800",
  not_eligible: "bg-red-100 text-red-800",
  documents_pending: "bg-amber-100 text-amber-800",
  submitted: "bg-indigo-100 text-indigo-800",
  technically_qualified: "bg-teal-100 text-teal-800",
  commercially_opened: "bg-purple-100 text-purple-800",
  won: "bg-green-100 text-green-800",
  lost: "bg-red-100 text-red-800",
  cancelled: "bg-slate-100 text-slate-500"
};

export function TendersClient({ initialTenders, canCreate }: { initialTenders: Tender[]; canCreate: boolean }) {
  const router = useRouter();
  const [filterStatus, setFilterStatus] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Tender | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [isPending, startTransition] = useTransition();
  const [now] = useState(() => Date.now());

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return initialTenders.filter((tender) => {
      const statusMatch = filterStatus === "all" || tender.status === filterStatus;
      const searchMatch = !term || [tender.tender_number, tender.tender_title, tender.issuing_authority, tender.assigned_to, tender.sector, tender.status].some((value) => String(value ?? "").toLowerCase().includes(term));
      return statusMatch && searchMatch;
    });
  }, [filterStatus, initialTenders, query]);

  const stats = useMemo(() => ({
    active: initialTenders.filter((tender) => !["won", "lost", "cancelled", "not_eligible"].includes(tender.status)).length,
    won: initialTenders.filter((tender) => tender.status === "won").length,
    totalValue: initialTenders.filter((tender) => tender.status === "won").reduce((sum, tender) => sum + Number(tender.bid_value ?? 0), 0),
    emdLocked: initialTenders.filter((tender) => tender.emd_status === "paid").reduce((sum, tender) => sum + Number(tender.emd_amount ?? 0), 0),
    dueSoon: initialTenders.filter((tender) => {
      const diff = (new Date(tender.submission_deadline).getTime() - now) / 86400000;
      return diff >= 0 && diff <= 7 && !["won", "lost", "cancelled", "submitted"].includes(tender.status);
    }).length
  }), [initialTenders, now]);

  function submitTender(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await createTenderAction(form);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Tender saved");
      setForm(emptyForm);
      setShowForm(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tender Management"
        description="Track government, PSU, infrastructure, and export tenders using real tender records."
        actions={canCreate ? <Button onClick={() => setShowForm(true)}><Plus className="h-4 w-4" /> Add Tender</Button> : null}
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Metric label="Active Tenders" value={stats.active.toString()} icon={Clock} />
        <Metric label="Won" value={stats.won.toString()} icon={Trophy} />
        <Metric label="Won Value" value={formatCurrency(stats.totalValue)} icon={Landmark} />
        <Metric label="EMD Locked" value={formatCurrency(stats.emdLocked)} icon={AlertTriangle} />
        <Metric label="Due This Week" value={stats.dueSoon.toString()} icon={Calendar} />
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full lg:max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input className="form-input pl-9" placeholder="Search tender number, title, authority, owner..." value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
          <div className="flex flex-wrap gap-2">
            {["all", ...statuses].map((status) => (
              <button key={status} type="button" onClick={() => setFilterStatus(status)} className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${filterStatus === status ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                {status === "all" ? "All" : labelize(status)}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {filtered.length ? (
        <div className="space-y-3">
          {filtered.map((tender) => {
            const daysLeft = Math.ceil((new Date(tender.submission_deadline).getTime() - now) / 86400000);
            return (
              <Card key={tender.id} className="cursor-pointer transition hover:shadow-md" onClick={() => setSelected(tender)}>
                <CardContent className="p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[11px] font-bold text-slate-500">{tender.tender_number}</span>
                        <BadgeText className="bg-slate-100 text-slate-700">{labelize(tender.sector)}</BadgeText>
                        <BadgeText className={statusClass[tender.status] ?? statusClass.identified}>{labelize(tender.status)}</BadgeText>
                      </div>
                      <p className="line-clamp-2 text-sm font-black text-slate-950">{tender.tender_title}</p>
                      <p className="mt-1 text-xs font-semibold text-slate-500">{tender.issuing_authority} · Assigned: {tender.assigned_to || "Not assigned"}</p>
                    </div>
                    <div className="shrink-0 text-left lg:text-right">
                      <p className="text-lg font-black text-slate-950">{formatCurrency(tender.estimated_value)}</p>
                      <p className={`text-xs font-bold ${daysLeft < 0 ? "text-slate-400" : daysLeft <= 3 ? "text-red-600" : daysLeft <= 7 ? "text-amber-600" : "text-slate-500"}`}>
                        {daysLeft < 0 ? "Deadline passed" : daysLeft === 0 ? "Due today" : `${daysLeft} days left`}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs font-semibold text-slate-500">
                    <span>EMD: {formatCurrency(tender.emd_amount)} ({labelize(tender.emd_status)})</span>
                    {Number(tender.bid_value) > 0 ? <span>Bid: {formatCurrency(tender.bid_value)}</span> : null}
                    <span>Technical: {labelize(tender.technical_status)}</span>
                    <span>Commercial: {labelize(tender.commercial_status)}</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState title={initialTenders.length ? "No tenders match this filter" : "No tenders yet"} description={initialTenders.length ? "Change the status filter or search term to view more tender records." : "Add a tender when your sales team starts tracking a PSU, government, export, or infrastructure opportunity."} />
      )}

      {selected ? <TenderDetail tender={selected} onClose={() => setSelected(null)} /> : null}

      {showForm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={() => setShowForm(false)}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between rounded-t-3xl bg-slate-900 p-5 text-white">
              <div><p className="text-xs font-bold uppercase tracking-wider text-slate-400">New Tender</p><p className="mt-1 text-lg font-black">Register Tender</p></div>
              <button type="button" onClick={() => setShowForm(false)} className="rounded-lg p-2 hover:bg-white/10"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={submitTender} className="space-y-4 p-5">
              <div className="grid gap-3 md:grid-cols-2">
                <Field className="md:col-span-2" label="Tender Title"><input className="form-input" required value={form.tender_title} onChange={(event) => setForm({ ...form, tender_title: event.target.value })} /></Field>
                <Field label="Tender Number"><input className="form-input" required value={form.tender_number} onChange={(event) => setForm({ ...form, tender_number: event.target.value })} /></Field>
                <Field label="Issuing Authority"><input className="form-input" required value={form.issuing_authority} onChange={(event) => setForm({ ...form, issuing_authority: event.target.value })} /></Field>
                <Field label="Sector"><select className="form-input" value={form.sector} onChange={(event) => setForm({ ...form, sector: event.target.value as TenderFormInput["sector"] })}>{sectors.map((sector) => <option key={sector} value={sector}>{labelize(sector)}</option>)}</select></Field>
                <Field label="Submission Deadline"><input className="form-input" type="date" required value={form.submission_deadline} onChange={(event) => setForm({ ...form, submission_deadline: event.target.value })} /></Field>
                <Field label="Estimated Value"><input className="form-input" type="number" min="0" value={form.estimated_value} onChange={(event) => setForm({ ...form, estimated_value: Number(event.target.value) })} /></Field>
                <Field label="EMD Amount"><input className="form-input" type="number" min="0" value={form.emd_amount} onChange={(event) => setForm({ ...form, emd_amount: Number(event.target.value) })} /></Field>
                <Field label="Document Fee"><input className="form-input" type="number" min="0" value={form.document_fee} onChange={(event) => setForm({ ...form, document_fee: Number(event.target.value) })} /></Field>
                <Field label="Assigned To"><input className="form-input" value={form.assigned_to ?? ""} onChange={(event) => setForm({ ...form, assigned_to: event.target.value })} /></Field>
                <Field className="md:col-span-2" label="Tender URL"><input className="form-input" type="url" value={form.tender_url ?? ""} onChange={(event) => setForm({ ...form, tender_url: event.target.value })} /></Field>
                <Field className="md:col-span-2" label="Notes"><textarea className="form-input min-h-24" value={form.notes ?? ""} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></Field>
              </div>
              <div className="flex justify-end gap-3 border-t border-slate-200 pt-4">
                <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
                <Button type="submit" disabled={isPending}>{isPending ? "Saving..." : "Save Tender"}</Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-1 flex items-center gap-2"><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange/10"><Icon className="h-4 w-4 text-orange" /></div><p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</p></div>
        <p className="mt-2 text-xl font-black text-slate-950">{value}</p>
      </CardContent>
    </Card>
  );
}

function BadgeText({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${className}`}>{children}</span>;
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return <label className={`block space-y-1.5 ${className ?? ""}`}><span className="form-label">{label}</span>{children}</label>;
}

function TenderDetail({ tender, onClose }: { tender: Tender; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between rounded-t-3xl bg-slate-900 p-5 text-white">
          <div><p className="text-xs font-bold uppercase tracking-wider text-slate-400">{tender.tender_number}</p><p className="mt-1 text-lg font-black leading-tight">{tender.tender_title}</p></div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 hover:bg-white/10"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-5 p-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <DetailMetric label="Estimated Value" value={formatCurrency(tender.estimated_value)} />
            <DetailMetric label="EMD" value={formatCurrency(tender.emd_amount)} />
            <DetailMetric label="EMD Status" value={labelize(tender.emd_status)} />
            <DetailMetric label="Bid Value" value={Number(tender.bid_value) > 0 ? formatCurrency(tender.bid_value) : "Not Captured"} />
            <DetailMetric label="Technical" value={labelize(tender.technical_status)} />
            <DetailMetric label="Commercial" value={labelize(tender.commercial_status)} />
          </div>
          <div className="grid gap-3 text-sm md:grid-cols-2">
            <Info label="Issuing Authority" value={tender.issuing_authority} />
            <Info label="Sector" value={labelize(tender.sector)} />
            <Info label="Submission Deadline" value={formatDate(tender.submission_deadline)} />
            <Info label="Assigned To" value={tender.assigned_to || "Not assigned"} />
            <Info label="Competitor Notes" value={tender.competitor_notes || "Not Captured"} />
            <Info label="Notes" value={tender.notes || "Not Captured"} />
          </div>
          <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4">
            {tender.tender_url ? <Link href={tender.tender_url} target="_blank" className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 hover:border-orange hover:text-orange"><ExternalLink className="h-4 w-4" /> Open Tender URL</Link> : null}
            {tender.status === "won" && tender.converted_order_id ? <Link href={`/orders/${tender.converted_order_id}`} className="inline-flex items-center gap-2 rounded-2xl bg-green-600 px-3 py-2 text-sm font-bold text-white hover:bg-green-700"><CheckCircle2 className="h-4 w-4" /> View Converted Order</Link> : null}
            {tender.status === "won" && !tender.converted_order_id ? <span className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-800">Won tender not converted yet. Create the order from Orders and link the tender in notes.</span> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailMetric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-slate-50 p-3 text-center"><p className="text-[11px] font-bold uppercase text-slate-500">{label}</p><p className="mt-1 text-sm font-black text-slate-950">{value}</p></div>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><p className="mb-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</p><p className="font-semibold text-slate-800">{value}</p></div>;
}
