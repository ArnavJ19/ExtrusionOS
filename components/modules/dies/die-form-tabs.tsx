"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { dieStatuses, dieTypes, labelize } from "@/types/app";
import type { DieFormValues } from "./types";

type Option = { id: string; label: string; billet_diameter_required_inch?: number | null };

const TABS = ["Basic", "Geometry", "Material", "Performance", "Notes"] as const;
type FormTab = typeof TABS[number];

type Props = {
  form: DieFormValues;
  update: <K extends keyof DieFormValues>(key: K, value: DieFormValues[K]) => void;
  profiles: Option[];
  customers: Option[];
};

export function DieFormTabs({ form, update, profiles, customers }: Props) {
  const [tab, setTab] = useState<FormTab>("Basic");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 rounded-2xl border border-slate-200 bg-aluminium/50 p-1">
        {TABS.map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={`rounded-xl px-4 py-2 text-sm font-bold transition ${tab === t ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === "Basic" && (
        <Card>
          <CardHeader><h2 className="section-title">Die Identity & Classification</h2></CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Field label="Die number *" value={form.die_number} onChange={(v) => update("die_number", v)} />
              <Field label="Die code" value={form.die_code} onChange={(v) => update("die_code", v)} />
              <Field label="Internal reference" value={form.internal_die_reference} onChange={(v) => update("internal_die_reference", v)} />
              <Field label="Customer reference" value={form.customer_die_reference} onChange={(v) => update("customer_die_reference", v)} />
              <div className="block space-y-1.5 xl:col-span-2">
                <span className="form-label">Linked profile *</span>
                <SearchableSelect value={form.profile_id} placeholder="Select profile" options={profiles.map((p) => ({ value: p.id, label: p.label }))} onChange={(v) => update("profile_id", v)} />
              </div>
              <SelectField label="Ownership" value={form.ownership_type} onChange={(v) => update("ownership_type", v)} options={[
                { value: "company_owned", label: "Company Owned" },
                { value: "customer_owned", label: "Customer Owned" },
                { value: "shared", label: "Shared" },
                { value: "trial", label: "Trial" },
                { value: "archived", label: "Archived" },
              ]} />
              <div className="block space-y-1.5">
                <span className="form-label">Customer</span>
                <SearchableSelect value={form.customer_id} placeholder="No customer" disabled={form.ownership_type !== "customer_owned"} options={customers.map((c) => ({ value: c.id, label: c.label }))} onChange={(v) => update("customer_id", v)} />
              </div>
              <SelectField label="Status" value={form.die_status} onChange={(v) => update("die_status", v)} options={dieStatuses.map((s) => ({ value: s, label: labelize(s) }))} />
              <SelectField label="Die type" value={form.die_type} onChange={(v) => update("die_type", v)} options={dieTypes.map((t) => ({ value: t, label: labelize(t) }))} />
              <NumField label="Number of cavities" value={form.number_of_cavities} onChange={(v) => update("number_of_cavities", v)} min={1} step="1" />
              <NumField label="Number of holes" value={form.number_of_holes} onChange={(v) => update("number_of_holes", v)} min={0} step="1" />
              <Field label="Die class" value={form.die_class} onChange={(v) => update("die_class", v)} />
              <Field label="Application category" value={form.application_category} onChange={(v) => update("application_category", v)} />
              <Field label="End-use industry" value={form.end_use_industry} onChange={(v) => update("end_use_industry", v)} />
              <Field label="Press compatibility" value={form.press_compatibility} onChange={(v) => update("press_compatibility", v)} />
              <SelectField label="Priority" value={form.priority_level} onChange={(v) => update("priority_level", v)} options={[
                { value: "low", label: "Low" }, { value: "normal", label: "Normal" }, { value: "high", label: "High" }, { value: "critical", label: "Critical" }
              ]} />
            </div>
          </CardContent>
        </Card>
      )}

      {tab === "Geometry" && (
        <Card>
          <CardHeader><h2 className="section-title">Die Design & Geometry</h2></CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <NumField label="Die diameter (mm)" value={form.die_diameter_mm} onChange={(v) => update("die_diameter_mm", v)} step="0.01" />
              <NumField label="Die thickness (mm)" value={form.die_thickness_mm} onChange={(v) => update("die_thickness_mm", v)} step="0.01" />
              <NumField label="Stack height (mm)" value={form.die_stack_height_mm} onChange={(v) => update("die_stack_height_mm", v)} step="0.01" />
              <NumField label="Backer diameter (mm)" value={form.backer_diameter_mm} onChange={(v) => update("backer_diameter_mm", v)} step="0.01" />
              <NumField label="Bolster diameter (mm)" value={form.bolster_diameter_mm} onChange={(v) => update("bolster_diameter_mm", v)} step="0.01" />
              <NumField label="Bearing length (mm)" value={form.bearing_length_mm} onChange={(v) => update("bearing_length_mm", v)} step="0.01" />
              <NumField label="Entry angle (°)" value={form.entry_angle_degrees} onChange={(v) => update("entry_angle_degrees", v)} step="0.1" />
              <NumField label="Relief angle (°)" value={form.relief_angle_degrees} onChange={(v) => update("relief_angle_degrees", v)} step="0.1" />
              <NumField label="Tongue ratio" value={form.tongue_ratio} onChange={(v) => update("tongue_ratio", v)} step="0.001" />
              <NumField label="Extrusion ratio" value={form.extrusion_ratio} onChange={(v) => update("extrusion_ratio", v)} step="0.01" />
              <NumField label="CCD (mm)" value={form.ccd_mm} onChange={(v) => update("ccd_mm", v)} step="0.01" />
              <NumField label="Output per stroke (kg)" value={form.output_per_stroke_kg} onChange={(v) => update("output_per_stroke_kg", v)} step="0.001" />
              <NumField label="Billet diameter (inch)" value={form.billet_diameter_required_inch} onChange={(v) => update("billet_diameter_required_inch", v)} step="0.01" />
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <TextArea label="Feeder plate details" value={form.feeder_plate_details} onChange={(v) => update("feeder_plate_details", v)} />
              <TextArea label="Mandrel details" value={form.mandrel_details} onChange={(v) => update("mandrel_details", v)} />
              <TextArea label="Bridge details" value={form.bridge_details} onChange={(v) => update("bridge_details", v)} />
              <TextArea label="Porthole details" value={form.porthole_details} onChange={(v) => update("porthole_details", v)} />
              <TextArea label="Welding chamber" value={form.welding_chamber_details} onChange={(v) => update("welding_chamber_details", v)} />
              <TextArea label="Bearing corrections" value={form.bearing_corrections} onChange={(v) => update("bearing_corrections", v)} />
              <TextArea label="Pocketing details" value={form.pocketing_details} onChange={(v) => update("pocketing_details", v)} />
              <TextArea label="Choke details" value={form.choke_details} onChange={(v) => update("choke_details", v)} />
            </div>
          </CardContent>
        </Card>
      )}

      {tab === "Material" && (
        <Card>
          <CardHeader><h2 className="section-title">Material, Manufacturing & Drawing</h2></CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Field label="Die steel grade" value={form.die_steel_grade} onChange={(v) => update("die_steel_grade", v)} />
              <Field label="Die manufacturer" value={form.die_manufacturer} onChange={(v) => update("die_manufacturer", v)} />
              <Field label="Purchase order ref" value={form.purchase_order_reference} onChange={(v) => update("purchase_order_reference", v)} />
              <NumField label="Die cost (₹)" value={form.die_cost} onChange={(v) => update("die_cost", v)} step="0.01" />
              <DateField label="Manufacturing date" value={form.manufacturing_date} onChange={(v) => update("manufacturing_date", v)} />
              <DateField label="Receipt date" value={form.receipt_date} onChange={(v) => update("receipt_date", v)} />
              <DateField label="Purchase date" value={form.purchase_date} onChange={(v) => update("purchase_date", v)} />
              <Field label="Heat treatment status" value={form.heat_treatment_status} onChange={(v) => update("heat_treatment_status", v)} />
              <NumField label="Hardness before nitriding" value={form.hardness_before_nitriding} onChange={(v) => update("hardness_before_nitriding", v)} step="0.1" />
              <NumField label="Hardness after nitriding" value={form.hardness_after_nitriding} onChange={(v) => update("hardness_after_nitriding", v)} step="0.1" />
              <NumField label="HRC value" value={form.hrc_value} onChange={(v) => update("hrc_value", v)} step="0.1" />
              <NumField label="HV value" value={form.hv_value} onChange={(v) => update("hv_value", v)} step="0.1" />
              <SelectField label="Dimensional inspection" value={form.dimensional_inspection_status} onChange={(v) => update("dimensional_inspection_status", v)} options={[
                { value: "", label: "Not set" }, { value: "pending", label: "Pending" }, { value: "passed", label: "Passed" }, { value: "failed", label: "Failed" }, { value: "not_required", label: "Not Required" }
              ]} />
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Field label="Drawing revision" value={form.drawing_revision} onChange={(v) => update("drawing_revision", v)} />
              <SelectField label="Drawing approval" value={form.drawing_approval_status} onChange={(v) => update("drawing_approval_status", v)} options={[
                { value: "pending", label: "Pending" }, { value: "approved", label: "Approved" }, { value: "rejected", label: "Rejected" }, { value: "superseded", label: "Superseded" }
              ]} />
              <Field label="Drawing URL" value={form.drawing_url} onChange={(v) => update("drawing_url", v)} />
            </div>
          </CardContent>
        </Card>
      )}

      {tab === "Performance" && (
        <Card>
          <CardHeader><h2 className="section-title">Performance & Storage</h2></CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <NumField label="Total production (kg)" value={form.total_production_kg} onChange={(v) => update("total_production_kg", v)} step="0.001" />
              <NumField label="Total runs" value={form.total_runs} onChange={(v) => update("total_runs", v)} step="1" />
              <DateField label="Last used" value={form.last_used_date} onChange={(v) => update("last_used_date", v)} />
              <SelectField label="Performance grade" value={form.performance_grade} onChange={(v) => update("performance_grade", v)} options={[
                { value: "excellent", label: "Excellent" }, { value: "good", label: "Good" }, { value: "average", label: "Average" }, { value: "problematic", label: "Problematic" }, { value: "blocked", label: "Blocked" }
              ]} />
              <Field label="Rack / location" value={form.rack_location} onChange={(v) => update("rack_location", v)} />
              <Field label="Storage bin" value={form.storage_bin} onChange={(v) => update("storage_bin", v)} />
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Field label="Blocked reason" value={form.die_blocked_reason} onChange={(v) => update("die_blocked_reason", v)} />
              <Field label="Retirement reason" value={form.die_retirement_reason} onChange={(v) => update("die_retirement_reason", v)} />
            </div>
          </CardContent>
        </Card>
      )}

      {tab === "Notes" && (
        <Card>
          <CardHeader><h2 className="section-title">Correction History & Notes</h2></CardHeader>
          <CardContent className="space-y-4">
            <TextArea label="Correction history" value={form.correction_history} onChange={(v) => update("correction_history", v)} rows={5} />
            <TextArea label="Notes" value={form.notes} onChange={(v) => update("notes", v)} rows={4} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// --- Reusable field components ---

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <label className="block space-y-1.5"><span className="form-label">{label}</span><input className="form-input" value={value} onChange={(e) => onChange(e.target.value)} /></label>;
}

function NumField({ label, value, onChange, step = "any", min = 0 }: { label: string; value: number | string; onChange: (v: any) => void; step?: string; min?: number }) {
  return <label className="block space-y-1.5"><span className="form-label">{label}</span><input className="form-input" type="number" min={min} step={step} value={value} onChange={(e) => onChange(e.target.value)} /></label>;
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <label className="block space-y-1.5"><span className="form-label">{label}</span><input className="form-input" type="date" value={value} onChange={(e) => onChange(e.target.value)} /></label>;
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return <label className="block space-y-1.5"><span className="form-label">{label}</span><select className="form-input" value={value} onChange={(e) => onChange(e.target.value)}>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>;
}

function TextArea({ label, value, onChange, rows = 3 }: { label: string; value: string; onChange: (v: string) => void; rows?: number }) {
  return <label className="block space-y-1.5"><span className="form-label">{label}</span><textarea className="form-input" rows={rows} value={value} onChange={(e) => onChange(e.target.value)} /></label>;
}
