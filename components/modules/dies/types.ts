export type DieRow = Record<string, any> & {
  id: string;
  die_number: string;
  die_code: string | null;
  die_status: string;
  die_type: string;
  ownership_type: string;
  number_of_cavities: number | null;
  priority_level: string;
  die_diameter_mm: number | null;
  billet_diameter_required_inch: number | null;
  rack_location: string | null;
  storage_bin: string | null;
  total_production_kg: number | null;
  total_runs: number | null;
  total_good_output_kg: number | null;
  average_recovery_percent: number | null;
  performance_grade: string | null;
  last_used_date: string | null;
  die_manufacturer: string | null;
  die_cost: number | null;
  drawing_approval_status: string | null;
  created_at: string;
  aluminium_profiles?: { profile_code: string | null; profile_name: string | null; section_weight_kg_per_m: number | null } | null;
  customers?: { customer_name: string | null; company_name: string | null } | null;
};

export type DieFormValues = {
  die_number: string;
  die_code: string;
  internal_die_reference: string;
  customer_die_reference: string;
  profile_id: string;
  customer_id: string;
  ownership_type: string;
  die_status: string;
  die_type: string;
  number_of_cavities: number | string;
  number_of_holes: number | string;
  die_class: string;
  application_category: string;
  end_use_industry: string;
  press_compatibility: string;
  priority_level: string;
  // Geometry
  die_diameter_mm: number | string;
  die_thickness_mm: number | string;
  die_stack_height_mm: number | string;
  backer_diameter_mm: number | string;
  bolster_diameter_mm: number | string;
  bearing_length_mm: number | string;
  entry_angle_degrees: number | string;
  relief_angle_degrees: number | string;
  tongue_ratio: number | string;
  extrusion_ratio: number | string;
  ccd_mm: number | string;
  output_per_stroke_kg: number | string;
  feeder_plate_details: string;
  mandrel_details: string;
  bridge_details: string;
  porthole_details: string;
  welding_chamber_details: string;
  bearing_corrections: string;
  pocketing_details: string;
  choke_details: string;
  // Drawing
  drawing_revision: string;
  drawing_approval_status: string;
  // Material
  die_steel_grade: string;
  die_vendor_id: string;
  purchase_order_reference: string;
  manufacturing_date: string;
  receipt_date: string;
  heat_treatment_status: string;
  hardness_before_nitriding: number | string;
  hardness_after_nitriding: number | string;
  hrc_value: number | string;
  hv_value: number | string;
  dimensional_inspection_status: string;
  // Performance
  performance_grade: string;
  die_blocked_reason: string;
  die_retirement_reason: string;
  storage_bin: string;
  // Legacy
  billet_diameter_required_inch: number | string;
  rack_location: string;
  total_production_kg: number | string;
  total_runs: number | string;
  last_used_date: string;
  die_manufacturer: string;
  die_cost: number | string;
  purchase_date: string;
  correction_history: string;
  drawing_url: string;
  notes: string;
};

export const emptyDieForm: DieFormValues = {
  die_number: "",
  die_code: "",
  internal_die_reference: "",
  customer_die_reference: "",
  profile_id: "",
  customer_id: "",
  ownership_type: "company_owned",
  die_status: "active",
  die_type: "solid",
  number_of_cavities: 1,
  number_of_holes: "",
  die_class: "",
  application_category: "",
  end_use_industry: "",
  press_compatibility: "",
  priority_level: "normal",
  die_diameter_mm: "",
  die_thickness_mm: "",
  die_stack_height_mm: "",
  backer_diameter_mm: "",
  bolster_diameter_mm: "",
  bearing_length_mm: "",
  entry_angle_degrees: "",
  relief_angle_degrees: "",
  tongue_ratio: "",
  extrusion_ratio: "",
  ccd_mm: "",
  output_per_stroke_kg: "",
  feeder_plate_details: "",
  mandrel_details: "",
  bridge_details: "",
  porthole_details: "",
  welding_chamber_details: "",
  bearing_corrections: "",
  pocketing_details: "",
  choke_details: "",
  drawing_revision: "",
  drawing_approval_status: "pending",
  die_steel_grade: "",
  die_vendor_id: "",
  purchase_order_reference: "",
  manufacturing_date: "",
  receipt_date: "",
  heat_treatment_status: "",
  hardness_before_nitriding: "",
  hardness_after_nitriding: "",
  hrc_value: "",
  hv_value: "",
  dimensional_inspection_status: "",
  performance_grade: "good",
  die_blocked_reason: "",
  die_retirement_reason: "",
  storage_bin: "",
  billet_diameter_required_inch: "",
  rack_location: "",
  total_production_kg: 0,
  total_runs: 0,
  last_used_date: "",
  die_manufacturer: "",
  die_cost: "",
  purchase_date: "",
  correction_history: "",
  drawing_url: "",
  notes: ""
};

export function customerName(row: DieRow) {
  return row.customers?.company_name || row.customers?.customer_name || "-";
}

export function profileLabel(row: DieRow) {
  const code = row.aluminium_profiles?.profile_code || "-";
  const name = row.aluminium_profiles?.profile_name || "";
  return `${code}${name ? ` · ${name}` : ""}`;
}
