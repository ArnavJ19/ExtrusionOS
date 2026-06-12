export type ProfileRow = Record<string, any> & {
  id: string;
  profile_code: string;
  profile_name: string;
  section_number: string | null;
  application_category: string;
  system_type: string | null;
  profile_classification: string;
  section_weight_kg_per_m: number | null;
  alloy: string | null;
  temper: string | null;
  standard_length_m: number | null;
  approval_status: string | null;
  drawing_approval_status: string | null;
  is_active: boolean;
  primary_die_id: string | null;
  created_at: string;
};

export type ProfileFormValues = Record<string, any>;

export const emptyProfileForm: ProfileFormValues = {
  profile_code: "",
  profile_name: "",
  section_number: "",
  internal_profile_reference: "",
  customer_profile_reference: "",
  application_category: "sliding_window",
  product_family: "",
  system_type: "",
  end_use_industry: "",
  section_weight_kg_per_m: "",
  actual_weight_kg_per_m: "",
  weight_tolerance_percent: "",
  alloy: "6063",
  temper: "T6",
  recommended_alloy: "",
  temper_requirement: "",
  tensile_strength_mpa: "",
  yield_strength_mpa: "",
  elongation_percent: "",
  finish_options: "mill_finish, powder_coating, anodizing",
  standard_length_m: "5.8",
  min_cutting_length_m: "",
  max_cutting_length_m: "",
  billet_diameter_required_inch: "",
  section_perimeter_mm: "",
  circumscribing_circle_diameter_mm: "",
  nominal_wall_thickness_mm: "",
  min_wall_thickness_mm: "",
  max_wall_thickness_mm: "",
  critical_wall_thickness_mm: "",
  profile_classification: "solid",
  number_of_voids: 0,
  complexity_rating: "standard",
  tolerance_class: "",
  bundle_quantity: "",
  pieces_per_bundle: "",
  meter_per_bundle: "",
  kg_per_bundle: "",
  surface_area_per_meter_sqm: "",
  powder_coating_area_sqm: "",
  anodizing_area_sqm: "",
  scrap_factor_percent: "",
  recovery_target_percent: "",
  min_acceptable_recovery_percent: "",
  recommended_press: "",
  billet_alloy: "",
  billet_temperature_range: "",
  container_temperature_range: "",
  die_temperature_range: "",
  ram_speed_range: "",
  exit_temperature_range: "",
  puller_speed_range: "",
  quench_method: "",
  stretching_requirement: "",
  aging_requirement: "",
  cutting_instructions: "",
  handling_instructions: "",
  special_production_notes: "",
  mill_finish_allowed: true,
  powder_coating_allowed: true,
  anodizing_allowed: true,
  wood_finish_allowed: false,
  pvdf_allowed: false,
  special_finish_allowed: false,
  coating_thickness_microns: "",
  anodizing_micron_requirement: "",
  pre_treatment_requirement: "",
  base_rate_per_kg: "",
  minimum_order_quantity_kg: "",
  packing_cost_per_kg: "",
  production_cost_per_kg: "",
  energy_cost_per_kg: "",
  primary_die_id: "",
  backup_die_id: "",
  drawing_revision: "",
  drawing_approval_status: "pending",
  approval_status: "draft",
  drawing_url: "",
  cross_section_image_url: "",
  image_url: "",
  notes: "",
  is_active: true
};
