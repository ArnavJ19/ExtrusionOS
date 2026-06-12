"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingState } from "@/components/ui/loading";
import { dieSchema } from "@/lib/validations/schemas";
import { createClient } from "@/lib/supabase/browser";
import { getErrorMessage } from "@/lib/utils/errors";
import { updateDieWithVersioning } from "@/lib/actions/die-actions";
import type { SessionContext } from "@/types/app";
import { emptyDieForm, type DieFormValues } from "./types";
import { DieFormTabs } from "./die-form-tabs";

type Option = { id: string; label: string; billet_diameter_required_inch?: number | null };

function nextDieNumber(existingNumbers: string[]) {
  const max = existingNumbers.reduce((current, value) => {
    const match = value.match(/^D-(\d+)$/);
    return match ? Math.max(current, Number(match[1])) : current;
  }, 0);
  return `D-${String(max + 1).padStart(3, "0")}`;
}

export function DieFormClient({ context, dieId }: { context: SessionContext; dieId?: string }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [profiles, setProfiles] = useState<Option[]>([]);
  const [customers, setCustomers] = useState<Option[]>([]);
  const [form, setForm] = useState<DieFormValues>(emptyDieForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editing = Boolean(dieId);

  function update<K extends keyof DieFormValues>(key: K, value: DieFormValues[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function loadForm() {
    setLoading(true);
    setError(null);
    const [profileResult, customerResult, dieResult] = await Promise.all([
      supabase.from("aluminium_profiles").select("id, profile_code, profile_name, billet_diameter_required_inch").eq("company_id", context.companyId).order("profile_code"),
      supabase.from("customers").select("id, customer_name, company_name").eq("company_id", context.companyId).order("customer_name"),
      dieId ? supabase.from("dies").select("*").eq("id", dieId).eq("company_id", context.companyId).single() : Promise.resolve({ data: null, error: null })
    ]);

    if (profileResult.error) throw profileResult.error;
    if (customerResult.error) throw customerResult.error;
    if (dieResult.error) throw dieResult.error;

    setProfiles((profileResult.data ?? []).map((profile: any) => ({ id: profile.id, label: `${profile.profile_code} · ${profile.profile_name}`, billet_diameter_required_inch: profile.billet_diameter_required_inch })));
    setCustomers((customerResult.data ?? []).map((customer: any) => ({ id: customer.id, label: customer.company_name || customer.customer_name })));
    if (dieResult.data) {
      const d = dieResult.data;
      setForm({
        die_number: d.die_number ?? "",
        die_code: d.die_code ?? "",
        internal_die_reference: d.internal_die_reference ?? "",
        customer_die_reference: d.customer_die_reference ?? "",
        profile_id: d.profile_id ?? "",
        customer_id: d.customer_id ?? "",
        ownership_type: d.ownership_type ?? "company_owned",
        die_status: d.die_status ?? "active",
        die_type: d.die_type ?? "solid",
        number_of_cavities: d.number_of_cavities ?? 1,
        number_of_holes: d.number_of_holes ?? "",
        die_class: d.die_class ?? "",
        application_category: d.application_category ?? "",
        end_use_industry: d.end_use_industry ?? "",
        press_compatibility: d.press_compatibility ?? "",
        priority_level: d.priority_level ?? "normal",
        die_diameter_mm: d.die_diameter_mm ?? "",
        die_thickness_mm: d.die_thickness_mm ?? "",
        die_stack_height_mm: d.die_stack_height_mm ?? "",
        backer_diameter_mm: d.backer_diameter_mm ?? "",
        bolster_diameter_mm: d.bolster_diameter_mm ?? "",
        bearing_length_mm: d.bearing_length_mm ?? "",
        entry_angle_degrees: d.entry_angle_degrees ?? "",
        relief_angle_degrees: d.relief_angle_degrees ?? "",
        tongue_ratio: d.tongue_ratio ?? "",
        extrusion_ratio: d.extrusion_ratio ?? "",
        ccd_mm: d.ccd_mm ?? "",
        output_per_stroke_kg: d.output_per_stroke_kg ?? "",
        feeder_plate_details: d.feeder_plate_details ?? "",
        mandrel_details: d.mandrel_details ?? "",
        bridge_details: d.bridge_details ?? "",
        porthole_details: d.porthole_details ?? "",
        welding_chamber_details: d.welding_chamber_details ?? "",
        bearing_corrections: d.bearing_corrections ?? "",
        pocketing_details: d.pocketing_details ?? "",
        choke_details: d.choke_details ?? "",
        drawing_revision: d.drawing_revision ?? "",
        drawing_approval_status: d.drawing_approval_status ?? "pending",
        die_steel_grade: d.die_steel_grade ?? "",
        die_vendor_id: d.die_vendor_id ?? "",
        purchase_order_reference: d.purchase_order_reference ?? "",
        manufacturing_date: d.manufacturing_date ?? "",
        receipt_date: d.receipt_date ?? "",
        heat_treatment_status: d.heat_treatment_status ?? "",
        hardness_before_nitriding: d.hardness_before_nitriding ?? "",
        hardness_after_nitriding: d.hardness_after_nitriding ?? "",
        hrc_value: d.hrc_value ?? "",
        hv_value: d.hv_value ?? "",
        dimensional_inspection_status: d.dimensional_inspection_status ?? "",
        performance_grade: d.performance_grade ?? "good",
        die_blocked_reason: d.die_blocked_reason ?? "",
        die_retirement_reason: d.die_retirement_reason ?? "",
        storage_bin: d.storage_bin ?? "",
        billet_diameter_required_inch: d.billet_diameter_required_inch ?? "",
        rack_location: d.rack_location ?? "",
        total_production_kg: d.total_production_kg ?? 0,
        total_runs: d.total_runs ?? 0,
        last_used_date: d.last_used_date ?? "",
        die_manufacturer: d.die_manufacturer ?? "",
        die_cost: d.die_cost ?? "",
        purchase_date: d.purchase_date ?? "",
        correction_history: d.correction_history ?? "",
        drawing_url: d.drawing_url ?? "",
        notes: d.notes ?? ""
      });
    } else {
      const { data: dieNumbers, error: numberError } = await supabase.from("dies").select("die_number").eq("company_id", context.companyId);
      if (numberError) throw numberError;
      setForm((current) => ({ ...current, die_number: nextDieNumber((dieNumbers ?? []).map((row: any) => row.die_number).filter(Boolean)) }));
    }
  }

  useEffect(() => {
    loadForm().catch((err) => {
      const message = getErrorMessage(err, "Could not load die form");
      setError(message);
      toast.error(message);
    }).finally(() => setLoading(false));
  }, [dieId]);

  async function submit() {
    const parsed = dieSchema.safeParse(form);
    if (!parsed.success) return toast.error(parsed.error.issues[0]?.message ?? "Please check die details");
    setSaving(true);
    let duplicateRequest = supabase
      .from("dies")
      .select("id", { count: "exact", head: true })
      .eq("company_id", context.companyId)
      .eq("die_number", parsed.data.die_number);
    if (editing && dieId) duplicateRequest = duplicateRequest.neq("id", dieId);
    const duplicate = await duplicateRequest;
    if (duplicate.error) {
      setSaving(false);
      return toast.error(getErrorMessage(duplicate.error, "Could not validate die number"));
    }
    if ((duplicate.count ?? 0) > 0) {
      setSaving(false);
      return toast.error("Die number already exists for this company. Use a unique die number for production and correction traceability.");
    }
    const payload = {
      ...parsed.data,
      customer_id: parsed.data.customer_id || null,
      company_id: context.companyId,
      created_by: context.userId
    };

    let resultId: string | undefined;

    if (editing && dieId) {
      // Use versioned server action for edits
      const versionResult = await updateDieWithVersioning(dieId, payload);
      if (!versionResult.success) { setSaving(false); return toast.error(versionResult.error ?? "Could not save die"); }
      resultId = dieId;
    } else {
      const result = await supabase.from("dies").insert(payload).select("id").single();
      if (result.error || !result.data) { setSaving(false); return toast.error(getErrorMessage(result.error, "Could not save die")); }
      resultId = result.data.id;
    }
    setSaving(false);

    toast.success(editing ? "Die updated" : "Die added");
    router.push(`/dies/${resultId}`);
    router.refresh();
  }

  if (loading) return <LoadingState title={editing ? "Loading die" : "Preparing die form"} description="Fetching profiles and customers for this company." />;
  if (error) return <ErrorState description={error} onRetry={() => void loadForm()} />;

  return (
    <div className="space-y-6">
      <div>
        <Link href={editing && dieId ? `/dies/${dieId}` : "/dies"} className="mb-3 inline-flex items-center gap-2 text-sm font-black text-slate-500 transition hover:text-orange"><ArrowLeft className="h-4 w-4" /> {editing ? "Back to Die" : "Back to Dies"}</Link>
        <h1 className="text-3xl font-black tracking-tight text-slate-950">{editing ? "Edit Die" : "Add Die"}</h1>
        <p className="mt-2 max-w-3xl text-sm font-medium leading-6 text-slate-500">Complete die technical identity — design, geometry, material, manufacturing, and performance data.</p>
      </div>

      <DieFormTabs form={form} update={update} profiles={profiles} customers={customers} />

      <div className="flex flex-col gap-2 border-t border-slate-200 pt-5 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={() => router.back()}>Cancel</Button>
        <Button type="button" disabled={saving} onClick={submit}>{saving ? "Saving..." : editing ? "Update Die" : "Add Die"}</Button>
      </div>
    </div>
  );
}
