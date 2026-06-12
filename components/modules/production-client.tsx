"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingState } from "@/components/ui/loading";
import { PageHeader } from "@/components/layout/page-header";
import { saveProductionJobAction, updateProductionJobStatusAction } from "@/lib/actions/production";
import { formatDate, formatWeight } from "@/lib/utils/format";
import { labelize, type SessionContext } from "@/types/app";

type ProductionJob = {
  id: string;
  planned_quantity_kg: number;
  actual_quantity_kg: number;
  status: string;
  planned_date: string | null;
  shift: string | null;
  operator_name: string | null;
  remarks: string | null;
  profile: { profile_code: string; profile_name: string } | null;
  machine: { machine_name: string } | null;
  die: { die_number: string } | null;
  order: { order_number: string } | null;
};

export function ProductionClient({ context }: { context: SessionContext }) {
  const supabase = useMemo(() => createClient(), []);
  const [jobs, setJobs] = useState<ProductionJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state for creating a new production job
  const [form, setForm] = useState({ order_id: "", profile_id: "", machine_id: "", die_id: "", planned_quantity_kg: 0, planned_date: "", shift: "", operator_name: "", remarks: "" });
  const [orders, setOrders] = useState<{ id: string; order_number: string }[]>([]);
  const [profiles, setProfiles] = useState<{ id: string; profile_code: string; profile_name: string }[]>([]);
  const [machines, setMachines] = useState<{ id: string; machine_name: string }[]>([]);
  const [dies, setDies] = useState<{ id: string; die_number: string; profile_id: string }[]>([]);

  async function loadJobs() {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("production_jobs")
        .select(`
          id,
          planned_quantity_kg,
          actual_quantity_kg,
          status,
          planned_date,
          shift,
          operator_name,
          remarks,
          profile:aluminium_profiles(profile_code, profile_name),
          machine:machines(machine_name),
          die:dies(die_number),
          order:orders(order_number)
        `)
        .eq("company_id", context.companyId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setJobs((data as unknown as ProductionJob[]) || []);
    } catch (err: any) {
      toast.error("Failed to load production jobs", { description: err.message });
    } finally {
      setIsLoading(false);
    }
  }

  async function loadFormData() {
    const [orderRes, profileRes, machineRes, dieRes] = await Promise.all([
      supabase.from("orders").select("id, order_number").eq("company_id", context.companyId).not("current_stage", "in", '("closed","cancelled","delivered")').order("order_date", { ascending: false }),
      supabase.from("aluminium_profiles").select("id, profile_code, profile_name").eq("company_id", context.companyId).eq("is_active", true).order("profile_code"),
      supabase.from("machines").select("id, machine_name").eq("company_id", context.companyId).order("machine_name"),
      supabase.from("dies").select("id, die_number, profile_id").eq("company_id", context.companyId).eq("die_status", "active").order("die_number")
    ]);
    setOrders(orderRes.data ?? []);
    setProfiles(profileRes.data ?? []);
    setMachines(machineRes.data ?? []);
    setDies(dieRes.data ?? []);
  }

  useEffect(() => { void loadJobs(); }, [supabase]);

  async function openForm() {
    setShowForm(true);
    await loadFormData();
  }

  async function createJob() {
    if (!form.order_id || !form.profile_id) return toast.error("Order and Profile are required");
    if (!form.die_id) return toast.error("Die is required before scheduling production");
    if (form.planned_quantity_kg <= 0) return toast.error("Planned quantity must be greater than zero");
    setSaving(true);
    const result = await saveProductionJobAction({
      job_number: "",
      order_id: form.order_id,
      profile_id: form.profile_id,
      machine_id: form.machine_id || null,
      die_id: form.die_id,
      planned_quantity_kg: form.planned_quantity_kg,
      pieces: 0,
      required_billet_count: 0,
      extrusion_efficiency_percent: 75,
      length_per_piece_m: null,
      planned_date: form.planned_date || null,
      shift: form.shift || null,
      operator_name: form.operator_name || null,
      remarks: form.remarks || null,
      status: "planned"
    });
    setSaving(false);
    if (!result.success) return toast.error(result.error);
    toast.success("Production job planned");
    setShowForm(false);
    setForm({ order_id: "", profile_id: "", machine_id: "", die_id: "", planned_quantity_kg: 0, planned_date: "", shift: "", operator_name: "", remarks: "" });
    await loadJobs();
  }

  async function updateJobStatus(jobId: string, status: string) {
    const result = await updateProductionJobStatusAction(jobId, status);
    if (!result.success) return toast.error(result.error);
    toast.success(`Job status updated to ${labelize(status)}`);
    await loadJobs();
  }

  if (isLoading) return <LoadingState title="Loading production jobs" description="Fetching production schedule for this company." />;

  const compatibleDies = dies.filter(d => !form.profile_id || d.profile_id === form.profile_id);
  const statusColors: Record<string, string> = {
    planned: "bg-slate-100 text-slate-700",
    ready: "bg-blue-50 text-blue-700",
    in_progress: "bg-orange-50 text-orange-700",
    completed: "bg-emerald-50 text-emerald-700",
    on_hold: "bg-amber-50 text-amber-700",
    cancelled: "bg-red-50 text-red-700"
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Production Planning"
        description="Monitor and manage extrusion jobs across machines."
        actions={<Button onClick={openForm}>Plan New Job</Button>}
      />

      {showForm && (
        <Card>
          <CardContent>
            <h2 className="section-title mb-1">Plan new production job</h2>
            <p className="mb-5 text-sm font-medium text-slate-500">Assign an order to a press with die, operator, and schedule details.</p>
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block space-y-1.5"><span className="form-label">Order *</span><select className="form-input" value={form.order_id} onChange={e => setForm({ ...form, order_id: e.target.value })}><option value="">Select order</option>{orders.map(o => <option key={o.id} value={o.id}>{o.order_number}</option>)}</select></label>
              <label className="block space-y-1.5"><span className="form-label">Profile *</span><select className="form-input" value={form.profile_id} onChange={e => setForm({ ...form, profile_id: e.target.value, die_id: "" })}><option value="">Select profile</option>{profiles.map(p => <option key={p.id} value={p.id}>{p.profile_code} · {p.profile_name}</option>)}</select></label>
              <label className="block space-y-1.5"><span className="form-label">Machine</span><select className="form-input" value={form.machine_id} onChange={e => setForm({ ...form, machine_id: e.target.value })}><option value="">Unassigned</option>{machines.map(m => <option key={m.id} value={m.id}>{m.machine_name}</option>)}</select></label>
              <label className="block space-y-1.5"><span className="form-label">Die</span><select className="form-input" value={form.die_id} onChange={e => setForm({ ...form, die_id: e.target.value })}><option value="">No die</option>{compatibleDies.map(d => <option key={d.id} value={d.id}>{d.die_number}</option>)}</select></label>
              <label className="block space-y-1.5"><span className="form-label">Planned qty (kg) *</span><input className="form-input" type="number" min="0" step="0.001" value={form.planned_quantity_kg || ""} onChange={e => setForm({ ...form, planned_quantity_kg: Number(e.target.value) })} /></label>
              <label className="block space-y-1.5"><span className="form-label">Planned date</span><input className="form-input" type="date" value={form.planned_date} onChange={e => setForm({ ...form, planned_date: e.target.value })} /></label>
              <label className="block space-y-1.5"><span className="form-label">Shift</span><select className="form-input" value={form.shift} onChange={e => setForm({ ...form, shift: e.target.value })}><option value="">Select</option><option value="day">Day</option><option value="night">Night</option></select></label>
              <label className="block space-y-1.5"><span className="form-label">Operator</span><input className="form-input" value={form.operator_name} onChange={e => setForm({ ...form, operator_name: e.target.value })} /></label>
              <label className="block space-y-1.5"><span className="form-label">Remarks</span><input className="form-input" value={form.remarks} onChange={e => setForm({ ...form, remarks: e.target.value })} /></label>
            </div>
            <div className="mt-4 flex gap-2">
              <Button disabled={saving} onClick={createJob}>{saving ? "Saving..." : "Create Job"}</Button>
              <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {jobs.length === 0 ? (
        <EmptyState
          title="No production jobs"
          description="Create your first production job to start planning extrusion runs."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {jobs.map(job => (
            <Card key={job.id} className="overflow-hidden">
              <CardContent className="p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-lg text-slate-950">{job.order?.order_number || "Unlinked"}</span>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusColors[job.status] || "bg-slate-100 text-slate-700"}`}>{labelize(job.status)}</span>
                </div>

                <div className="text-sm text-slate-500">
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span>Profile:</span>
                    <span className="text-slate-900 font-medium">{job.profile?.profile_code || "N/A"}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span>Planned:</span>
                    <span className="text-slate-900 font-medium">{formatWeight(job.planned_quantity_kg)}</span>
                  </div>
                  {job.actual_quantity_kg > 0 && (
                    <div className="flex justify-between py-1 border-b border-slate-100">
                      <span>Actual:</span>
                      <span className="text-slate-900 font-medium">{formatWeight(job.actual_quantity_kg)}</span>
                    </div>
                  )}
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span>Machine:</span>
                    <span className="text-slate-900 font-medium">{job.machine?.machine_name || "Unassigned"}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span>Die:</span>
                    <span className="text-slate-900 font-medium">{job.die?.die_number || "N/A"}</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span>Date:</span>
                    <span className="text-slate-900 font-medium">{job.planned_date ? formatDate(job.planned_date) : "Not scheduled"}</span>
                  </div>
                </div>

                <div className="flex gap-1.5 flex-wrap mt-1">
                  {job.status === "planned" && <Button variant="ghost" onClick={() => updateJobStatus(job.id, "ready")}>Mark Ready</Button>}
                  {job.status === "ready" && <Button variant="ghost" onClick={() => updateJobStatus(job.id, "in_progress")}>Start</Button>}
                  {job.status === "in_progress" && <Button variant="ghost" onClick={() => updateJobStatus(job.id, "completed")}>Complete</Button>}
                  {["planned", "ready", "in_progress"].includes(job.status) && <Button variant="ghost" onClick={() => updateJobStatus(job.id, "on_hold")}>Hold</Button>}
                  {job.status === "on_hold" && <Button variant="ghost" onClick={() => updateJobStatus(job.id, "in_progress")}>Resume</Button>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
