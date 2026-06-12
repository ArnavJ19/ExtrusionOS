"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { applicationCategories, profileClassifications, profileComplexities, drawingApprovalStatuses, profileApprovalStatuses, labelize } from "@/types/app";
import { Field, NumField, SelectField, TextArea, CheckField } from "./profile-form-fields";
import type { ProfileFormValues } from "./types";

type Option = { value: string; label: string };

const TABS = ["Basic", "Geometry", "Production", "Surface", "Costing", "Notes"] as const;
type FormTab = typeof TABS[number];

type Props = {
  form: ProfileFormValues;
  update: (key: string, value: any) => void;
  dies: Option[];
};

export function ProfileFormTabs({ form, update, dies }: Props) {
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
          <CardHeader><h2 className="section-title">Profile Identity & Classification</h2></CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Field label="Profile code" value={form.profile_code} onChange={(v) => update("profile_code", v)} required />
              <Field label="Profile name" value={form.profile_name} onChange={(v) => update("profile_name", v)} required />
              <Field label="Section number" value={form.section_number} onChange={(v) => update("section_number", v)} />
              <Field label="Internal reference" value={form.internal_profile_reference} onChange={(v) => update("internal_profile_reference", v)} />
              <Field label="Customer reference" value={form.customer_profile_reference} onChange={(v) => update("customer_profile_reference", v)} />
              <SelectField label="Application category" value={form.application_category} onChange={(v) => update("application_category", v)} options={applicationCategories.map((c) => ({ value: c, label: labelize(c) }))} />
              <Field label="Product family" value={form.product_family} onChange={(v) => update("product_family", v)} />
              <Field label="System type" value={form.system_type} onChange={(v) => update("system_type", v)} />
              <Field label="End-use industry" value={form.end_use_industry} onChange={(v) => update("end_use_industry", v)} />
              <NumField label="Section weight kg/m" value={form.section_weight_kg_per_m} onChange={(v) => update("section_weight_kg_per_m", v)} step="0.001" required />
              <NumField label="Actual weight kg/m" value={form.actual_weight_kg_per_m} onChange={(v) => update("actual_weight_kg_per_m", v)} step="0.001" />
              <NumField label="Weight tolerance %" value={form.weight_tolerance_percent} onChange={(v) => update("weight_tolerance_percent", v)} step="0.01" />
              <Field label="Alloy" value={form.alloy} onChange={(v) => update("alloy", v)} />
              <Field label="Temper" value={form.temper} onChange={(v) => update("temper", v)} />
              <Field label="Recommended alloy" value={form.recommended_alloy} onChange={(v) => update("recommended_alloy", v)} />
              <NumField label="Standard length (m)" value={form.standard_length_m} onChange={(v) => update("standard_length_m", v)} step="0.01" />
              <NumField label="Min cutting length (m)" value={form.min_cutting_length_m} onChange={(v) => update("min_cutting_length_m", v)} step="0.001" />
              <NumField label="Max cutting length (m)" value={form.max_cutting_length_m} onChange={(v) => update("max_cutting_length_m", v)} step="0.001" />
              <Field label="Finish options (comma sep)" value={form.finish_options} onChange={(v) => update("finish_options", v)} />
              <SelectField label="Approval status" value={form.approval_status} onChange={(v) => update("approval_status", v)} options={profileApprovalStatuses.map((s) => ({ value: s, label: labelize(s) }))} />
              <SelectField label="Drawing approval" value={form.drawing_approval_status} onChange={(v) => update("drawing_approval_status", v)} options={drawingApprovalStatuses.map((s) => ({ value: s, label: labelize(s) }))} />
              <Field label="Drawing revision" value={form.drawing_revision} onChange={(v) => update("drawing_revision", v)} />
              <CheckField label="Active" value={form.is_active} onChange={(v) => update("is_active", v)} />
            </div>
          </CardContent>
        </Card>
      )}

      {tab === "Geometry" && (
        <Card>
          <CardHeader><h2 className="section-title">Geometry, Classification & Tolerances</h2></CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <SelectField label="Profile classification" value={form.profile_classification} onChange={(v) => update("profile_classification", v)} options={profileClassifications.map((c) => ({ value: c, label: labelize(c) }))} />
              <NumField label="Number of voids" value={form.number_of_voids} onChange={(v) => update("number_of_voids", v)} step="1" />
              <SelectField label="Complexity rating" value={form.complexity_rating} onChange={(v) => update("complexity_rating", v)} options={profileComplexities.map((c) => ({ value: c, label: labelize(c) }))} />
              <Field label="Tolerance class" value={form.tolerance_class} onChange={(v) => update("tolerance_class", v)} />
              <NumField label="Section perimeter (mm)" value={form.section_perimeter_mm} onChange={(v) => update("section_perimeter_mm", v)} step="0.01" />
              <NumField label="CCD (mm)" value={form.circumscribing_circle_diameter_mm} onChange={(v) => update("circumscribing_circle_diameter_mm", v)} step="0.01" />
              <NumField label="Nominal wall thickness (mm)" value={form.nominal_wall_thickness_mm} onChange={(v) => update("nominal_wall_thickness_mm", v)} step="0.01" />
              <NumField label="Min wall thickness (mm)" value={form.min_wall_thickness_mm} onChange={(v) => update("min_wall_thickness_mm", v)} step="0.01" />
              <NumField label="Max wall thickness (mm)" value={form.max_wall_thickness_mm} onChange={(v) => update("max_wall_thickness_mm", v)} step="0.01" />
              <NumField label="Critical wall thickness (mm)" value={form.critical_wall_thickness_mm} onChange={(v) => update("critical_wall_thickness_mm", v)} step="0.01" />
              <NumField label="Surface area per meter (sqm)" value={form.surface_area_per_meter_sqm} onChange={(v) => update("surface_area_per_meter_sqm", v)} step="0.0001" />
              <NumField label="Powder coating area (sqm)" value={form.powder_coating_area_sqm} onChange={(v) => update("powder_coating_area_sqm", v)} step="0.0001" />
              <NumField label="Anodizing area (sqm)" value={form.anodizing_area_sqm} onChange={(v) => update("anodizing_area_sqm", v)} step="0.0001" />
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <NumField label="Bundle quantity" value={form.bundle_quantity} onChange={(v) => update("bundle_quantity", v)} step="1" />
              <NumField label="Pieces per bundle" value={form.pieces_per_bundle} onChange={(v) => update("pieces_per_bundle", v)} step="1" />
              <NumField label="Meter per bundle" value={form.meter_per_bundle} onChange={(v) => update("meter_per_bundle", v)} step="0.001" />
              <NumField label="Kg per bundle" value={form.kg_per_bundle} onChange={(v) => update("kg_per_bundle", v)} step="0.001" />
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-3">
              <NumField label="Scrap factor %" value={form.scrap_factor_percent} onChange={(v) => update("scrap_factor_percent", v)} step="0.01" />
              <NumField label="Recovery target %" value={form.recovery_target_percent} onChange={(v) => update("recovery_target_percent", v)} step="0.01" />
              <NumField label="Min acceptable recovery %" value={form.min_acceptable_recovery_percent} onChange={(v) => update("min_acceptable_recovery_percent", v)} step="0.01" />
            </div>
          </CardContent>
        </Card>
      )}

      {tab === "Production" && (
        <Card>
          <CardHeader><h2 className="section-title">Production Parameters & Die Linkage</h2></CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Field label="Recommended press" value={form.recommended_press} onChange={(v) => update("recommended_press", v)} />
              <NumField label="Billet diameter (inch)" value={form.billet_diameter_required_inch} onChange={(v) => update("billet_diameter_required_inch", v)} step="0.01" />
              <Field label="Billet alloy" value={form.billet_alloy} onChange={(v) => update("billet_alloy", v)} />
              <Field label="Billet temperature range" value={form.billet_temperature_range} onChange={(v) => update("billet_temperature_range", v)} />
              <Field label="Container temp range" value={form.container_temperature_range} onChange={(v) => update("container_temperature_range", v)} />
              <Field label="Die temp range" value={form.die_temperature_range} onChange={(v) => update("die_temperature_range", v)} />
              <Field label="Ram speed range" value={form.ram_speed_range} onChange={(v) => update("ram_speed_range", v)} />
              <Field label="Exit temperature range" value={form.exit_temperature_range} onChange={(v) => update("exit_temperature_range", v)} />
              <Field label="Puller speed range" value={form.puller_speed_range} onChange={(v) => update("puller_speed_range", v)} />
              <Field label="Quench method" value={form.quench_method} onChange={(v) => update("quench_method", v)} />
              <Field label="Stretching requirement" value={form.stretching_requirement} onChange={(v) => update("stretching_requirement", v)} />
              <Field label="Aging requirement" value={form.aging_requirement} onChange={(v) => update("aging_requirement", v)} />
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <NumField label="Tensile strength (MPa)" value={form.tensile_strength_mpa} onChange={(v) => update("tensile_strength_mpa", v)} step="0.01" />
              <NumField label="Yield strength (MPa)" value={form.yield_strength_mpa} onChange={(v) => update("yield_strength_mpa", v)} step="0.01" />
              <NumField label="Elongation %" value={form.elongation_percent} onChange={(v) => update("elongation_percent", v)} step="0.01" />
              <Field label="Temper requirement" value={form.temper_requirement} onChange={(v) => update("temper_requirement", v)} />
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="block space-y-1.5">
                <span className="form-label">Primary die</span>
                <SearchableSelect value={form.primary_die_id} placeholder="Select primary die" options={dies} onChange={(v) => update("primary_die_id", v)} />
              </div>
              <div className="block space-y-1.5">
                <span className="form-label">Backup die</span>
                <SearchableSelect value={form.backup_die_id} placeholder="Select backup die" options={dies} onChange={(v) => update("backup_die_id", v)} />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {tab === "Surface" && (
        <Card>
          <CardHeader><h2 className="section-title">Surface Treatment & Finish Options</h2></CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <CheckField label="Mill finish allowed" value={form.mill_finish_allowed} onChange={(v) => update("mill_finish_allowed", v)} />
              <CheckField label="Powder coating allowed" value={form.powder_coating_allowed} onChange={(v) => update("powder_coating_allowed", v)} />
              <CheckField label="Anodizing allowed" value={form.anodizing_allowed} onChange={(v) => update("anodizing_allowed", v)} />
              <CheckField label="Wood finish allowed" value={form.wood_finish_allowed} onChange={(v) => update("wood_finish_allowed", v)} />
              <CheckField label="PVDF allowed" value={form.pvdf_allowed} onChange={(v) => update("pvdf_allowed", v)} />
              <CheckField label="Special finish allowed" value={form.special_finish_allowed} onChange={(v) => update("special_finish_allowed", v)} />
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <NumField label="Coating thickness (microns)" value={form.coating_thickness_microns} onChange={(v) => update("coating_thickness_microns", v)} step="0.1" />
              <NumField label="Anodizing requirement (microns)" value={form.anodizing_micron_requirement} onChange={(v) => update("anodizing_micron_requirement", v)} step="0.1" />
              <Field label="Pre-treatment requirement" value={form.pre_treatment_requirement} onChange={(v) => update("pre_treatment_requirement", v)} />
            </div>
          </CardContent>
        </Card>
      )}

      {tab === "Costing" && (
        <Card>
          <CardHeader><h2 className="section-title">Commercial & Costing</h2></CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <NumField label="Base rate ₹/kg" value={form.base_rate_per_kg} onChange={(v) => update("base_rate_per_kg", v)} step="0.01" />
              <NumField label="Min order qty (kg)" value={form.minimum_order_quantity_kg} onChange={(v) => update("minimum_order_quantity_kg", v)} step="0.01" />
              <NumField label="Packing cost ₹/kg" value={form.packing_cost_per_kg} onChange={(v) => update("packing_cost_per_kg", v)} step="0.01" />
              <NumField label="Production cost ₹/kg" value={form.production_cost_per_kg} onChange={(v) => update("production_cost_per_kg", v)} step="0.01" />
              <NumField label="Energy cost ₹/kg" value={form.energy_cost_per_kg} onChange={(v) => update("energy_cost_per_kg", v)} step="0.01" />
            </div>
          </CardContent>
        </Card>
      )}

      {tab === "Notes" && (
        <Card>
          <CardHeader><h2 className="section-title">Drawing, Images & Notes</h2></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Field label="Drawing URL" value={form.drawing_url} onChange={(v) => update("drawing_url", v)} />
              <Field label="Cross-section image URL" value={form.cross_section_image_url} onChange={(v) => update("cross_section_image_url", v)} />
              <Field label="Image URL" value={form.image_url} onChange={(v) => update("image_url", v)} />
            </div>
            <TextArea label="Cutting instructions" value={form.cutting_instructions} onChange={(v) => update("cutting_instructions", v)} />
            <TextArea label="Handling instructions" value={form.handling_instructions} onChange={(v) => update("handling_instructions", v)} />
            <TextArea label="Special production notes" value={form.special_production_notes} onChange={(v) => update("special_production_notes", v)} />
            <TextArea label="Notes" value={form.notes} onChange={(v) => update("notes", v)} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
