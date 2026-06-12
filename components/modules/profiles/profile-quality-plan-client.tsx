"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { createClient } from "@/lib/supabase/browser";
import { getErrorMessage } from "@/lib/utils/errors";
import type { SessionContext } from "@/types/app";

type QualityPlanItem = {
  id: string;
  inspection_stage: string;
  parameter_name: string;
  acceptance_criteria: string;
  rejection_criteria: string;
  inspection_frequency: string;
  is_mandatory: boolean;
};

const INSPECTION_STAGES = ["First Piece", "In Process", "Final", "Dimensional", "Surface", "Weight", "Hardness", "Coating", "Anodizing", "Mechanical", "Packing"];
const DEFAULT_PARAMETERS = ["Weight per meter", "Dimensional tolerance", "Surface finish", "Straightness", "Twist", "Bow", "Hardness", "Coating thickness", "Anodizing microns", "Visual inspection"];

export function ProfileQualityPlanClient({ context, profileId }: { context: SessionContext; profileId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<QualityPlanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function loadPlan() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("profile_quality_plans")
        .select("*")
        .eq("company_id", context.companyId)
        .eq("profile_id", profileId)
        .eq("is_active", true)
        .order("created_at", { ascending: true });
      if (error) { console.warn("profile_quality_plans query failed:", error); setLoading(false); return; }
      setItems((data ?? []).map((d: any) => ({ id: d.id, inspection_stage: d.inspection_stage, parameter_name: d.parameter_name, acceptance_criteria: d.acceptance_criteria ?? "", rejection_criteria: d.rejection_criteria ?? "", inspection_frequency: d.inspection_frequency ?? "", is_mandatory: d.is_mandatory ?? true })));
    } catch (err) {
      console.warn("profile_quality_plans query failed:", err);
    }
    setLoading(false);
  }

  useEffect(() => { void loadPlan(); }, [profileId]);

  function addItem() {
    setItems((prev) => [...prev, { id: `new-${Date.now()}`, inspection_stage: "", parameter_name: "", acceptance_criteria: "", rejection_criteria: "", inspection_frequency: "", is_mandatory: true }]);
  }

  function removeItem(index: number) { setItems((prev) => prev.filter((_, i) => i !== index)); }
  function updateItem(index: number, field: keyof QualityPlanItem, value: any) { setItems((prev) => prev.map((item, i) => i === index ? { ...item, [field]: value } : item)); }

  async function savePlan() {
    const valid = items.filter((item) => item.inspection_stage && item.parameter_name);
    if (!valid.length) return toast.error("Add at least one quality parameter.");
    setSaving(true);

    // Deactivate existing and insert fresh
    await supabase.from("profile_quality_plans").update({ is_active: false }).eq("company_id", context.companyId).eq("profile_id", profileId);

    const rows = valid.map((item) => ({
      company_id: context.companyId,
      profile_id: profileId,
      inspection_stage: item.inspection_stage,
      parameter_name: item.parameter_name,
      acceptance_criteria: item.acceptance_criteria || null,
      rejection_criteria: item.rejection_criteria || null,
      inspection_frequency: item.inspection_frequency || null,
      is_mandatory: item.is_mandatory,
      is_active: true
    }));

    const { error } = await supabase.from("profile_quality_plans").insert(rows);
    setSaving(false);
    if (error) return toast.error(getErrorMessage(error));
    toast.success("Quality plan saved");
    void loadPlan();
  }

  if (loading) return <div className="p-4 text-sm text-slate-500">Loading quality plan...</div>;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <h2 className="section-title">Quality Inspection Plan</h2>
          <Button type="button" variant="secondary" onClick={addItem}><Plus className="mr-1 h-3.5 w-3.5" /> Add Parameter</Button>
        </div>
      </CardHeader>
      <CardContent>
        {!items.length ? (
          <EmptyState title="No quality plan defined" description="Define inspection parameters for this profile." />
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-[140px_160px_1fr_1fr_100px_60px_40px] gap-2 text-xs font-black uppercase tracking-wider text-slate-500 px-1">
              <span>Stage</span><span>Parameter</span><span>Accept</span><span>Reject</span><span>Frequency</span><span>Req</span><span></span>
            </div>
            {items.map((item, index) => (
              <div key={item.id} className="grid grid-cols-[140px_160px_1fr_1fr_100px_60px_40px] gap-2 items-center rounded-xl border border-slate-200 bg-white p-2">
                <select className="form-input text-xs" value={item.inspection_stage} onChange={(e) => updateItem(index, "inspection_stage", e.target.value)}>
                  <option value="">Stage...</option>
                  {INSPECTION_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <select className="form-input text-xs" value={item.parameter_name} onChange={(e) => updateItem(index, "parameter_name", e.target.value)}>
                  <option value="">Parameter...</option>
                  {DEFAULT_PARAMETERS.map((p) => <option key={p} value={p}>{p}</option>)}
                  {item.parameter_name && !DEFAULT_PARAMETERS.includes(item.parameter_name) && <option value={item.parameter_name}>{item.parameter_name}</option>}
                </select>
                <input className="form-input text-xs" placeholder="Accept criteria" value={item.acceptance_criteria} onChange={(e) => updateItem(index, "acceptance_criteria", e.target.value)} />
                <input className="form-input text-xs" placeholder="Reject criteria" value={item.rejection_criteria} onChange={(e) => updateItem(index, "rejection_criteria", e.target.value)} />
                <input className="form-input text-xs" placeholder="Freq" value={item.inspection_frequency} onChange={(e) => updateItem(index, "inspection_frequency", e.target.value)} />
                <input type="checkbox" checked={item.is_mandatory} onChange={(e) => updateItem(index, "is_mandatory", e.target.checked)} className="h-4 w-4 mx-auto" />
                <button type="button" onClick={() => removeItem(index)} className="text-slate-400 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        )}
        {items.length > 0 && (
          <div className="mt-4 flex justify-end">
            <Button type="button" disabled={saving} onClick={savePlan}>{saving ? "Saving..." : "Save Quality Plan"}</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
