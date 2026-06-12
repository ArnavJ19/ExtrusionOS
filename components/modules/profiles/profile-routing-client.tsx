"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { createClient } from "@/lib/supabase/browser";
import { getErrorMessage } from "@/lib/utils/errors";
import type { SessionContext } from "@/types/app";

type RoutingStep = {
  id: string;
  step_order: number;
  stage_name: string;
  is_required: boolean;
  department: string | null;
  estimated_duration_hours: number | null;
  notes: string | null;
};

const DEFAULT_STAGES = [
  "Extrusion",
  "Quenching",
  "Stretching",
  "Cutting",
  "Aging",
  "Powder Coating",
  "Anodizing",
  "Quality Inspection",
  "Packing",
  "Dispatch"
];

export function ProfileRoutingClient({ context, profileId }: { context: SessionContext; profileId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [steps, setSteps] = useState<RoutingStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function loadSteps() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("profile_routing_steps")
        .select("*")
        .eq("company_id", context.companyId)
        .eq("profile_id", profileId)
        .order("step_order", { ascending: true });
      if (error) { toast.error(getErrorMessage(error)); setLoading(false); return; }
      setSteps(data ?? []);
    } catch (err) {
      // Table may not exist yet if migrations haven't been applied
      console.warn("profile_routing_steps query failed:", err);
    }
    setLoading(false);
  }

  useEffect(() => { void loadSteps(); }, [profileId]);

  function addStep() {
    const nextOrder = steps.length + 1;
    setSteps((prev) => [...prev, {
      id: `new-${Date.now()}`,
      step_order: nextOrder,
      stage_name: "",
      is_required: true,
      department: null,
      estimated_duration_hours: null,
      notes: null
    }]);
  }

  function removeStep(index: number) {
    setSteps((prev) => prev.filter((_, i) => i !== index).map((s, i) => ({ ...s, step_order: i + 1 })));
  }

  function updateStep(index: number, field: keyof RoutingStep, value: any) {
    setSteps((prev) => prev.map((s, i) => i === index ? { ...s, [field]: value } : s));
  }

  async function saveSteps() {
    const valid = steps.filter((s) => s.stage_name.trim());
    if (!valid.length) return toast.error("Add at least one routing step.");
    setSaving(true);

    // Delete existing and re-insert
    await supabase.from("profile_routing_steps").delete().eq("company_id", context.companyId).eq("profile_id", profileId);

    const rows = valid.map((s, i) => ({
      company_id: context.companyId,
      profile_id: profileId,
      step_order: i + 1,
      stage_name: s.stage_name.trim(),
      is_required: s.is_required,
      department: s.department || null,
      estimated_duration_hours: s.estimated_duration_hours || null,
      notes: s.notes || null
    }));

    const { error } = await supabase.from("profile_routing_steps").insert(rows);
    setSaving(false);
    if (error) return toast.error(getErrorMessage(error));
    toast.success("Routing saved");
    void loadSteps();
  }

  async function autoRoute() {
    // Derive routing from profile's finish options by reading the profile
    const { data: profile } = await supabase.from("aluminium_profiles").select("powder_coating_allowed, anodizing_allowed, wood_finish_allowed, pvdf_allowed, aging_requirement, stretching_requirement").eq("id", profileId).eq("company_id", context.companyId).single();
    if (!profile) return toast.error("Could not read profile for auto-routing.");

    const route: string[] = ["Extrusion", "Quenching"];
    if (profile.stretching_requirement) route.push("Stretching");
    route.push("Cutting");
    if (profile.aging_requirement) route.push("Aging");
    if (profile.powder_coating_allowed) route.push("Powder Coating");
    if (profile.anodizing_allowed) route.push("Anodizing");
    if (profile.wood_finish_allowed) route.push("Wood Finish");
    if (profile.pvdf_allowed) route.push("PVDF");
    route.push("Quality Inspection", "Packing", "Dispatch");

    setSteps(route.map((name, i) => ({
      id: `auto-${i}`,
      step_order: i + 1,
      stage_name: name,
      is_required: true,
      department: null,
      estimated_duration_hours: null,
      notes: null
    })));
    toast.success("Auto-route generated from profile attributes. Review and save.");
  }

  if (loading) return <div className="p-4 text-sm text-slate-500">Loading routing...</div>;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <h2 className="section-title">Production Routing</h2>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={autoRoute}>Auto-Route</Button>
            <Button type="button" variant="secondary" onClick={addStep}><Plus className="mr-1 h-3.5 w-3.5" /> Add Step</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!steps.length ? (
          <EmptyState title="No routing defined" description="Define the manufacturing route for this profile. Use Auto-Route to generate from finish attributes." />
        ) : (
          <div className="space-y-2">
            {steps.map((step, index) => (
              <div key={step.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
                <GripVertical className="h-4 w-4 text-slate-400" />
                <span className="w-8 text-center text-xs font-black text-slate-500">{index + 1}</span>
                <select className="form-input w-48" value={step.stage_name} onChange={(e) => updateStep(index, "stage_name", e.target.value)}>
                  <option value="">Select stage...</option>
                  {DEFAULT_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                  {step.stage_name && !DEFAULT_STAGES.includes(step.stage_name) && <option value={step.stage_name}>{step.stage_name}</option>}
                </select>
                <input className="form-input w-28" placeholder="Department" value={step.department ?? ""} onChange={(e) => updateStep(index, "department", e.target.value)} />
                <input className="form-input w-20" type="number" placeholder="Hours" step="0.5" value={step.estimated_duration_hours ?? ""} onChange={(e) => updateStep(index, "estimated_duration_hours", e.target.value ? Number(e.target.value) : null)} />
                <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600">
                  <input type="checkbox" checked={step.is_required} onChange={(e) => updateStep(index, "is_required", e.target.checked)} className="h-3.5 w-3.5 rounded" /> Required
                </label>
                <button type="button" onClick={() => removeStep(index)} className="ml-auto text-slate-400 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        )}
        {steps.length > 0 && (
          <div className="mt-4 flex justify-end">
            <Button type="button" disabled={saving} onClick={saveSteps}>{saving ? "Saving..." : "Save Routing"}</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
