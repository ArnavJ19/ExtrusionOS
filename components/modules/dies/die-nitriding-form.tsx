"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/browser";
import { getErrorMessage } from "@/lib/utils/errors";
import type { SessionContext } from "@/types/app";

type NitridingFormValues = {
  nitriding_cycle_number: number | string;
  nitriding_vendor: string;
  nitriding_date: string;
  nitriding_process_type: string;
  nitriding_temperature_c: number | string;
  nitriding_duration_hours: number | string;
  case_depth_mm: number | string;
  white_layer_thickness_mm: number | string;
  surface_hardness: number | string;
  core_hardness: number | string;
  pre_nitriding_cleaning_done: boolean;
  post_nitriding_inspection_done: boolean;
  tons_since_last_nitriding: number | string;
  runs_since_last_nitriding: number | string;
  next_nitriding_due_date: string;
  status: string;
  notes: string;
};

const emptyForm: NitridingFormValues = {
  nitriding_cycle_number: 1,
  nitriding_vendor: "",
  nitriding_date: new Date().toISOString().slice(0, 10),
  nitriding_process_type: "",
  nitriding_temperature_c: "",
  nitriding_duration_hours: "",
  case_depth_mm: "",
  white_layer_thickness_mm: "",
  surface_hardness: "",
  core_hardness: "",
  pre_nitriding_cleaning_done: false,
  post_nitriding_inspection_done: false,
  tons_since_last_nitriding: "",
  runs_since_last_nitriding: "",
  next_nitriding_due_date: "",
  status: "completed",
  notes: ""
};

export function DieNitridingForm({ context, dieId, onSaved }: { context: SessionContext; dieId: string; onSaved?: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [form, setForm] = useState<NitridingFormValues>({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  function update<K extends keyof NitridingFormValues>(key: K, value: NitridingFormValues[K]) {
    setForm((c) => ({ ...c, [key]: value }));
  }

  async function submit() {
    if (!form.nitriding_date) return toast.error("Nitriding date is required");
    setSaving(true);

    const payload = {
      company_id: context.companyId,
      die_id: dieId,
      nitriding_cycle_number: Number(form.nitriding_cycle_number) || 1,
      nitriding_vendor: form.nitriding_vendor || null,
      nitriding_date: form.nitriding_date,
      nitriding_process_type: form.nitriding_process_type || null,
      nitriding_temperature_c: Number(form.nitriding_temperature_c) || null,
      nitriding_duration_hours: Number(form.nitriding_duration_hours) || null,
      case_depth_mm: Number(form.case_depth_mm) || null,
      white_layer_thickness_mm: Number(form.white_layer_thickness_mm) || null,
      surface_hardness: Number(form.surface_hardness) || null,
      core_hardness: Number(form.core_hardness) || null,
      pre_nitriding_cleaning_done: form.pre_nitriding_cleaning_done,
      post_nitriding_inspection_done: form.post_nitriding_inspection_done,
      tons_since_last_nitriding: Number(form.tons_since_last_nitriding) || null,
      runs_since_last_nitriding: Number(form.runs_since_last_nitriding) || null,
      next_nitriding_due_date: form.next_nitriding_due_date || null,
      status: form.status,
      notes: form.notes || null,
      created_by: context.userId
    };

    const { error } = await supabase.from("die_nitriding_history").insert(payload);
    setSaving(false);
    if (error) return toast.error(getErrorMessage(error));
    toast.success("Nitriding record saved");
    setForm({ ...emptyForm });
    setOpen(false);
    onSaved?.();
  }

  if (!open) {
    return <Button type="button" onClick={() => setOpen(true)}>Log Nitriding Cycle</Button>;
  }

  return (
    <Card className="border-orange/30">
      <CardHeader><h2 className="section-title">Log Nitriding Cycle</h2></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <label className="block space-y-1.5"><span className="form-label">Cycle number</span><input className="form-input" type="number" min="1" value={form.nitriding_cycle_number} onChange={(e) => update("nitriding_cycle_number", e.target.value)} /></label>
          <label className="block space-y-1.5"><span className="form-label">Date *</span><input className="form-input" type="date" value={form.nitriding_date} onChange={(e) => update("nitriding_date", e.target.value)} /></label>
          <label className="block space-y-1.5"><span className="form-label">Vendor</span><input className="form-input" value={form.nitriding_vendor} onChange={(e) => update("nitriding_vendor", e.target.value)} /></label>
          <label className="block space-y-1.5"><span className="form-label">Process type</span><input className="form-input" value={form.nitriding_process_type} onChange={(e) => update("nitriding_process_type", e.target.value)} placeholder="e.g. Gas, Salt bath, Plasma" /></label>
          <label className="block space-y-1.5"><span className="form-label">Temperature (°C)</span><input className="form-input" type="number" step="0.1" value={form.nitriding_temperature_c} onChange={(e) => update("nitriding_temperature_c", e.target.value)} /></label>
          <label className="block space-y-1.5"><span className="form-label">Duration (hours)</span><input className="form-input" type="number" step="0.5" value={form.nitriding_duration_hours} onChange={(e) => update("nitriding_duration_hours", e.target.value)} /></label>
          <label className="block space-y-1.5"><span className="form-label">Case depth (mm)</span><input className="form-input" type="number" step="0.001" value={form.case_depth_mm} onChange={(e) => update("case_depth_mm", e.target.value)} /></label>
          <label className="block space-y-1.5"><span className="form-label">White layer (mm)</span><input className="form-input" type="number" step="0.0001" value={form.white_layer_thickness_mm} onChange={(e) => update("white_layer_thickness_mm", e.target.value)} /></label>
          <label className="block space-y-1.5"><span className="form-label">Surface hardness (HV)</span><input className="form-input" type="number" step="0.1" value={form.surface_hardness} onChange={(e) => update("surface_hardness", e.target.value)} /></label>
          <label className="block space-y-1.5"><span className="form-label">Core hardness (HV)</span><input className="form-input" type="number" step="0.1" value={form.core_hardness} onChange={(e) => update("core_hardness", e.target.value)} /></label>
          <label className="block space-y-1.5"><span className="form-label">Next nitriding due</span><input className="form-input" type="date" value={form.next_nitriding_due_date} onChange={(e) => update("next_nitriding_due_date", e.target.value)} /></label>
          <label className="block space-y-1.5"><span className="form-label">Status</span><select className="form-input" value={form.status} onChange={(e) => update("status", e.target.value)}><option value="scheduled">Scheduled</option><option value="in_progress">In Progress</option><option value="completed">Completed</option><option value="failed">Failed</option></select></label>
        </div>
        <div className="flex gap-4">
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.pre_nitriding_cleaning_done} onChange={(e) => update("pre_nitriding_cleaning_done", e.target.checked)} className="h-4 w-4 rounded" /><span className="text-sm font-bold text-slate-700">Pre-nitriding cleaning done</span></label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.post_nitriding_inspection_done} onChange={(e) => update("post_nitriding_inspection_done", e.target.checked)} className="h-4 w-4 rounded" /><span className="text-sm font-bold text-slate-700">Post-nitriding inspection done</span></label>
        </div>
        <label className="block space-y-1.5"><span className="form-label">Notes</span><textarea className="form-input" rows={2} value={form.notes} onChange={(e) => update("notes", e.target.value)} /></label>
        <div className="flex gap-2 justify-end">
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
          <Button type="button" disabled={saving} onClick={submit}>{saving ? "Saving..." : "Save Nitriding Record"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
