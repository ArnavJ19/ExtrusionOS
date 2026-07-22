import { z } from "zod";
import { gstNumber, indianPhone, optionalEmail, optionalText } from "./common";

export const customerSchema = z.object({
  customer_name: z.string().trim().min(1, "Customer name is required"),
  company_name: optionalText,
  customer_type: z.enum(["fabricator", "dealer", "architect", "industrial", "solar", "government", "export", "contractor", "other"]),
  phone: indianPhone,
  whatsapp_number: indianPhone,
  email: optionalEmail,
  gst_number: gstNumber,
  billing_address: optionalText,
  shipping_address: optionalText,
  city: optionalText,
  state: optionalText,
  pincode: optionalText,
  contact_person: optionalText,
  payment_terms: optionalText,
  notes: optionalText,
  is_active: z.coerce.boolean().default(true)
});

export const profileSchema = z.object({
  profile_code: z.string().trim().min(1, "Profile code is required"),
  profile_name: z.string().trim().min(1, "Profile name is required"),
  section_number: optionalText,
  internal_profile_reference: optionalText,
  customer_profile_reference: optionalText,
  application_category: z.enum(["sliding_window", "casement_window", "door", "curtain_wall", "partition", "railing", "solar", "heat_sink", "industrial", "electrical", "automotive", "aerospace", "furniture", "custom", "other"]),
  product_family: optionalText,
  system_type: optionalText,
  end_use_industry: optionalText,
  section_weight_kg_per_m: z.coerce.number().positive("Section weight must be positive").max(1000, "Section weight looks too high"),
  actual_weight_kg_per_m: z.coerce.number().positive().max(1000).optional().nullable().transform((value) => value || null),
  weight_tolerance_percent: z.coerce.number().nonnegative().max(100).optional().nullable().transform((value) => value ?? null),
  alloy: optionalText,
  temper: optionalText,
  recommended_alloy: optionalText,
  temper_requirement: optionalText,
  tensile_strength_mpa: z.coerce.number().nonnegative().optional().nullable().transform((value) => value || null),
  yield_strength_mpa: z.coerce.number().nonnegative().optional().nullable().transform((value) => value || null),
  elongation_percent: z.coerce.number().nonnegative().max(100).optional().nullable().transform((value) => value || null),
  finish_options: z.union([z.string(), z.array(z.string())]).optional().nullable().transform((value) => {
    if (Array.isArray(value)) return value;
    return value ? value.split(",").map((item) => item.trim()).filter(Boolean) : [];
  }),
  standard_length_m: z.coerce.number().nonnegative().optional().nullable().transform((value) => value || null),
  min_cutting_length_m: z.coerce.number().positive().optional().nullable().transform((value) => value || null),
  max_cutting_length_m: z.coerce.number().positive().optional().nullable().transform((value) => value || null),
  billet_diameter_required_inch: z.coerce.number().positive("Required billet diameter must be positive").optional().nullable().transform((value) => value || null),
  // Geometry
  section_perimeter_mm: z.coerce.number().positive().optional().nullable().transform((value) => value || null),
  circumscribing_circle_diameter_mm: z.coerce.number().positive().optional().nullable().transform((value) => value || null),
  nominal_wall_thickness_mm: z.coerce.number().positive("Wall thickness must be positive").optional().nullable().transform((value) => value || null),
  min_wall_thickness_mm: z.coerce.number().positive().optional().nullable().transform((value) => value || null),
  max_wall_thickness_mm: z.coerce.number().positive().optional().nullable().transform((value) => value || null),
  critical_wall_thickness_mm: z.coerce.number().positive().optional().nullable().transform((value) => value || null),
  profile_classification: z.enum(["solid", "hollow", "semi_hollow"]).default("solid"),
  number_of_voids: z.coerce.number().int().nonnegative().default(0),
  complexity_rating: z.enum(["simple", "standard", "complex", "very_complex"]).default("standard"),
  tolerance_class: optionalText,
  // Bundle / packing
  bundle_quantity: z.coerce.number().int().positive().optional().nullable().transform((value) => value || null),
  pieces_per_bundle: z.coerce.number().int().positive().optional().nullable().transform((value) => value || null),
  meter_per_bundle: z.coerce.number().positive().optional().nullable().transform((value) => value || null),
  kg_per_bundle: z.coerce.number().positive().optional().nullable().transform((value) => value || null),
  // Surface area
  surface_area_per_meter_sqm: z.coerce.number().positive().optional().nullable().transform((value) => value || null),
  powder_coating_area_sqm: z.coerce.number().positive().optional().nullable().transform((value) => value || null),
  anodizing_area_sqm: z.coerce.number().positive().optional().nullable().transform((value) => value || null),
  scrap_factor_percent: z.coerce.number().nonnegative().max(100).optional().nullable().transform((value) => value ?? null),
  recovery_target_percent: z.coerce.number().nonnegative().max(100).optional().nullable().transform((value) => value ?? null),
  min_acceptable_recovery_percent: z.coerce.number().nonnegative().max(100).optional().nullable().transform((value) => value ?? null),
  // Production parameters
  recommended_press: optionalText,
  billet_alloy: optionalText,
  billet_temperature_range: optionalText,
  container_temperature_range: optionalText,
  die_temperature_range: optionalText,
  ram_speed_range: optionalText,
  exit_temperature_range: optionalText,
  puller_speed_range: optionalText,
  quench_method: optionalText,
  stretching_requirement: optionalText,
  aging_requirement: optionalText,
  cutting_instructions: optionalText,
  handling_instructions: optionalText,
  special_production_notes: optionalText,
  // Surface treatment
  mill_finish_allowed: z.coerce.boolean().default(true),
  powder_coating_allowed: z.coerce.boolean().default(true),
  anodizing_allowed: z.coerce.boolean().default(true),
  wood_finish_allowed: z.coerce.boolean().default(false),
  pvdf_allowed: z.coerce.boolean().default(false),
  special_finish_allowed: z.coerce.boolean().default(false),
  coating_thickness_microns: z.coerce.number().nonnegative().optional().nullable().transform((value) => value || null),
  anodizing_micron_requirement: z.coerce.number().nonnegative().optional().nullable().transform((value) => value || null),
  pre_treatment_requirement: optionalText,
  // Commercial
  base_rate_per_kg: z.coerce.number().nonnegative().optional().nullable().transform((value) => value || null),
  minimum_order_quantity_kg: z.coerce.number().nonnegative().optional().nullable().transform((value) => value || null),
  packing_cost_per_kg: z.coerce.number().nonnegative().optional().nullable().transform((value) => value || null),
  production_cost_per_kg: z.coerce.number().nonnegative().optional().nullable().transform((value) => value || null),
  energy_cost_per_kg: z.coerce.number().nonnegative().optional().nullable().transform((value) => value || null),
  // Die linkage
  primary_die_id: z.string().uuid().optional().nullable().or(z.literal("")),
  backup_die_id: z.string().uuid().optional().nullable().or(z.literal("")),
  // Drawing / approval
  drawing_revision: optionalText,
  drawing_approval_status: z.enum(["pending", "approved", "rejected", "superseded"]).default("pending"),
  approval_status: z.enum(["draft", "submitted", "approved", "rejected", "superseded"]).default("draft"),
  drawing_url: optionalText,
  cross_section_image_url: optionalText,
  image_url: optionalText,
  notes: optionalText,
  is_active: z.coerce.boolean().default(true)
}).superRefine((value, ctx) => {
  if (value.min_wall_thickness_mm && value.max_wall_thickness_mm && value.min_wall_thickness_mm > value.max_wall_thickness_mm) {
    ctx.addIssue({ code: "custom", path: ["max_wall_thickness_mm"], message: "Max wall thickness must be greater than or equal to min wall thickness" });
  }
  if (value.min_cutting_length_m && value.max_cutting_length_m && value.min_cutting_length_m > value.max_cutting_length_m) {
    ctx.addIssue({ code: "custom", path: ["max_cutting_length_m"], message: "Max cutting length must be greater than or equal to min cutting length" });
  }
});

export const dieSchema = z.object({
  die_number: z.string().trim().min(1, "Die number is required"),
  die_code: optionalText,
  internal_die_reference: optionalText,
  customer_die_reference: optionalText,
  profile_id: z.string().uuid("Select a profile"),
  customer_id: z.string().uuid().optional().nullable().or(z.literal("")),
  ownership_type: z.enum(["company_owned", "customer_owned", "shared", "trial", "archived"]),
  die_status: z.enum(["design", "ordered", "received", "under_trial", "approved", "active", "under_correction", "under_maintenance", "blocked", "retired", "scrapped", "trial", "correction", "nitriding", "inactive", "dead"]),
  die_type: z.enum(["solid", "hollow", "semi_hollow", "porthole", "bridge", "feeder", "multi_cavity", "flat", "special"]).default("solid"),
  number_of_cavities: z.coerce.number().int().positive().default(1),
  number_of_holes: z.coerce.number().int().nonnegative().optional().nullable().transform((value) => value || null),
  die_class: optionalText,
  application_category: optionalText,
  end_use_industry: optionalText,
  press_compatibility: optionalText,
  priority_level: z.enum(["low", "normal", "high", "critical"]).default("normal"),
  // Geometry
  die_diameter_mm: z.coerce.number().positive("Die diameter must be positive").optional().nullable().transform((value) => value || null),
  die_thickness_mm: z.coerce.number().positive("Die thickness must be positive").optional().nullable().transform((value) => value || null),
  die_stack_height_mm: z.coerce.number().positive().optional().nullable().transform((value) => value || null),
  backer_diameter_mm: z.coerce.number().positive().optional().nullable().transform((value) => value || null),
  bolster_diameter_mm: z.coerce.number().positive().optional().nullable().transform((value) => value || null),
  bearing_length_mm: z.coerce.number().positive().optional().nullable().transform((value) => value || null),
  entry_angle_degrees: z.coerce.number().positive().optional().nullable().transform((value) => value || null),
  relief_angle_degrees: z.coerce.number().positive().optional().nullable().transform((value) => value || null),
  tongue_ratio: z.coerce.number().positive().optional().nullable().transform((value) => value || null),
  extrusion_ratio: z.coerce.number().positive().optional().nullable().transform((value) => value || null),
  ccd_mm: z.coerce.number().positive().optional().nullable().transform((value) => value || null),
  output_per_stroke_kg: z.coerce.number().positive().optional().nullable().transform((value) => value || null),
  feeder_plate_details: optionalText,
  mandrel_details: optionalText,
  bridge_details: optionalText,
  porthole_details: optionalText,
  welding_chamber_details: optionalText,
  bearing_corrections: optionalText,
  pocketing_details: optionalText,
  choke_details: optionalText,
  // Drawing
  drawing_revision: optionalText,
  drawing_approval_status: z.enum(["pending", "approved", "rejected", "superseded"]).default("pending"),
  // Material and Manufacturing
  die_steel_grade: optionalText,
  die_vendor_id: z.string().uuid().optional().nullable().or(z.literal("")),
  purchase_order_reference: optionalText,
  manufacturing_date: optionalText,
  receipt_date: optionalText,
  heat_treatment_status: optionalText,
  hardness_before_nitriding: z.coerce.number().positive().optional().nullable().transform((value) => value || null),
  hardness_after_nitriding: z.coerce.number().positive().optional().nullable().transform((value) => value || null),
  hrc_value: z.coerce.number().positive().optional().nullable().transform((value) => value || null),
  hv_value: z.coerce.number().positive().optional().nullable().transform((value) => value || null),
  dimensional_inspection_status: z.enum(["pending", "passed", "failed", "not_required"]).optional().nullable(),
  // Performance
  performance_grade: z.enum(["excellent", "good", "average", "problematic", "blocked"]).default("good"),
  die_blocked_reason: optionalText,
  die_retirement_reason: optionalText,
  storage_bin: optionalText,
  // Legacy fields
  billet_diameter_required_inch: z.coerce.number().positive("Required billet diameter must be positive").optional().nullable().transform((value) => value || null),
  rack_location: optionalText,
  total_production_kg: z.coerce.number().nonnegative().default(0),
  total_runs: z.coerce.number().int().nonnegative().default(0),
  last_used_date: optionalText,
  die_manufacturer: optionalText,
  die_cost: z.coerce.number().nonnegative().optional().nullable().transform((value) => value || null),
  purchase_date: optionalText,
  correction_history: optionalText,
  drawing_url: optionalText,
  notes: optionalText
}).superRefine((value, ctx) => {
  if (value.ownership_type === "customer_owned" && !value.customer_id) ctx.addIssue({ code: "custom", path: ["customer_id"], message: "Customer-owned dies should be linked to a customer" });
});

export const quoteItemSchema = z.object({
  profile_id: z.string().uuid("Select a profile"),
  die_id: z.string().uuid().optional().nullable().or(z.literal("")),
  item_description: optionalText,
  quantity_pieces: z.coerce.number().int().positive().max(100000, "Quantity looks too high"),
  length_per_piece_m: z.coerce.number().positive().max(1000, "Length looks too high"),
  section_weight_kg_per_m: z.coerce.number().positive().max(1000, "Section weight looks too high"),
  scrap_allowance_percent: z.coerce.number().nonnegative().max(100, "Scrap allowance looks too high").default(0),
  expected_recovery_percent: z.coerce.number().nonnegative().max(100, "Recovery percent cannot exceed 100").default(100),
  minimum_billing_weight_kg: z.coerce.number().nonnegative().max(10000000, "Minimum billing weight looks too high").default(0),
  billet_rate_per_kg: z.coerce.number().nonnegative().max(1000000, "Billet rate looks too high"),
  conversion_charge_per_kg: z.coerce.number().nonnegative().max(1000000, "Conversion charge looks too high"),
  finishing_type: z.enum(["mill_finish", "powder_coating", "anodizing", "anodized_silver", "anodized_bronze", "anodized_black", "wood_finish", "wood_grain", "pvdf", "other"]),
  finishing_charge_type: z.enum(["per_kg", "per_meter", "fixed", "per_sqft"]),
  finishing_charge: z.coerce.number().nonnegative().max(10000000, "Finishing charge looks too high"),
  die_charge: z.coerce.number().nonnegative().max(10000000, "Die charge looks too high"),
  die_amortization_type: z.enum(["full_die_charge", "per_kg", "waived", "customer_paid"]).default("full_die_charge"),
  die_amortization_quantity_kg: z.coerce.number().nonnegative().max(10000000, "Die amortization quantity looks too high").default(0),
  packing_charge: z.coerce.number().nonnegative().max(10000000, "Packing charge looks too high"),
  transport_charge: z.coerce.number().nonnegative().max(10000000, "Transport charge looks too high"),
  other_charges: z.coerce.number().nonnegative().max(10000000, "Other charge looks too high"),
  margin_percent: z.coerce.number().nonnegative().max(1000, "Margin percent looks too high"),
  sales_price_override: z.coerce.number().nonnegative().max(1000000000, "Sales price override looks too high").optional().nullable().transform((value) => value || null),
  minimum_margin_percent: z.coerce.number().nonnegative().max(1000, "Minimum margin percent looks too high").default(0)
}).superRefine((value, ctx) => {
  if (value.die_amortization_type === "per_kg" && value.die_charge > 0 && value.die_amortization_quantity_kg <= 0) {
    ctx.addIssue({ code: "custom", path: ["die_amortization_quantity_kg"], message: "Enter expected kg when spreading die charge per kg" });
  }
});

export const quoteSchema = z.object({
  customer_id: z.string().uuid("Select a customer"),
  quote_date: z.string().min(1, "Quote date is required"),
  valid_until: optionalText,
  status: z.enum(["draft", "internal_review", "approved_for_sending", "sent", "customer_approved", "customer_rejected", "expired", "converted_to_order"]),
  gst_percent: z.coerce.number().nonnegative().max(100, "GST percent looks too high"),
  terms_and_conditions: optionalText,
  delivery_timeline: optionalText,
  payment_terms: optionalText,
  approval_notes: optionalText,
  notes: optionalText,
  items: z.array(quoteItemSchema).min(1, "Add at least one quote item")
});

export const orderSchema = z.object({
  customer_id: z.string().uuid("Select a customer"),
  quote_id: z.string().uuid().optional().nullable().or(z.literal("")),
  production_profile_id: z.string().uuid("Select a production profile").optional().nullable().or(z.literal("")),
  production_die_id: z.string().uuid("Select a production die").optional().nullable().or(z.literal("")),
  production_quantity_kg: z.coerce.number().nonnegative("Production quantity cannot be negative").optional().nullable(),
  production_pieces: z.coerce.number().int().nonnegative("Production pieces cannot be negative").optional().nullable(),
  billet_diameter_required_inch: z.coerce.number().positive("Required billet diameter must be positive").optional().nullable().transform((value) => value || null),
  order_date: z.string().min(1),
  expected_dispatch_date: optionalText,
  priority: z.enum(["low", "normal", "high", "urgent"]),
  current_stage: z.enum(["order_confirmed", "die_ready", "billet_ready", "billet_heating", "extrusion_planned", "extruded", "stretching", "cutting", "aging", "surface_treatment", "finishing", "packing", "dispatched", "delivered", "payment_pending", "closed", "cancelled"]),
  order_value: z.coerce.number().nonnegative().max(1000000000, "Order value looks too high"),
  production_notes: optionalText,
  notes: optionalText
});

export const dispatchSchema = z.object({
  order_id: z.string().uuid("Select an order"),
  dispatch_date: z.string().min(1),
  number_of_bundles: z.coerce.number().int().positive("Enter at least one physical bundle").max(100000, "Bundle count looks too high"),
  total_weight_kg: z.coerce.number().positive("Dispatch weight must be greater than zero").max(10000000, "Dispatch weight looks too high"),
  bundle_tare_weights_kg: z.string().trim().min(1, "Enter one measured tare weight for each bundle"),
  transporter_name: optionalText,
  vehicle_number: optionalText,
  driver_name: optionalText,
  driver_phone: indianPhone,
  eway_bill_number: optionalText,
  lr_number: optionalText,
  delivery_status: z.enum(["pending", "dispatched", "in_transit", "delivered", "delayed", "damaged", "returned"]),
  proof_of_delivery_url: optionalText,
  packing_list_url: optionalText,
  remarks: optionalText
});

export const companySettingsSchema = z.object({
  company: z.object({
    name: z.string().trim().min(1, "Company name is required"),
    legal_name: optionalText,
    logo_url: optionalText,
    gst_number: gstNumber,
    phone: indianPhone,
    email: optionalEmail,
    website: optionalText,
    billing_address: optionalText,
    city: optionalText,
    state: optionalText,
    pincode: optionalText
  }),
  settings: z.object({
    id: z.string().uuid().optional().nullable(),
    default_gst_percent: z.coerce.number().nonnegative().max(100, "Default GST percent looks too high"),
    default_margin_percent: z.coerce.number().nonnegative().max(1000, "Default margin percent looks too high"),
    default_conversion_charge_per_kg: z.coerce.number().nonnegative().max(1000000, "Conversion charge looks too high"),
    default_packing_charge: z.coerce.number().nonnegative().max(10000000, "Packing charge looks too high"),
    default_transport_charge: z.coerce.number().nonnegative().max(10000000, "Transport charge looks too high"),
    default_quote_validity_days: z.coerce.number().int().positive().max(365, "Quote validity should be within one year"),
    minimum_margin_percent: z.coerce.number().nonnegative().max(1000, "Minimum margin percent looks too high").default(8),
    require_approval_below_margin: z.coerce.boolean().default(true),
    quote_prefix: z.string().trim().min(1).max(12).default("Q"),
    order_prefix: z.string().trim().min(1).max(12).default("O"),
    dispatch_prefix: z.string().trim().min(1).max(12).default("D"),
    invoice_prefix: z.string().trim().min(1).max(12).default("INV"),
    default_quote_terms: optionalText,
    default_payment_terms: optionalText,
    default_delivery_terms: optionalText,
    default_bank_details: optionalText,
    default_terms_and_conditions: optionalText,
    enable_customer_portal: z.coerce.boolean().default(false),
    enable_inventory: z.coerce.boolean().default(false),
    enable_quality: z.coerce.boolean().default(false),
    enable_payments: z.coerce.boolean().default(false),
    ai_enabled: z.coerce.boolean().default(false),
    ai_provider: z.enum(["local_rules", "nvidia", "openai", "anthropic", "azure_openai", "other"]).default("local_rules"),
    ai_model: z.string().trim().min(1).max(80).default("local-rules-v1"),
    allow_external_ai: z.coerce.boolean().default(false),
    redact_sensitive_data: z.coerce.boolean().default(true),
    max_context_records: z.coerce.number().int().positive().max(50).default(10),
    bank_details: optionalText,
    signature_url: optionalText
  })
});

const hexColor = z.string().trim().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Use a valid hex color like #F97316");
const optionalDomain = z.string().trim().optional().nullable().refine((value) => !value || /^(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/.test(value), "Enter a valid domain like app.example.com").transform((value) => value || null);

export const brandingSettingsSchema = z.object({
  company: z.object({
    id: z.string().uuid().optional().nullable(),
    logo_url: optionalText
  }),
  settings: z.object({
    id: z.string().uuid().optional().nullable(),
    brand_primary_color: hexColor.default("#F97316"),
    brand_secondary_color: hexColor.default("#1E293B"),
    pdf_theme: z.enum(["industrial_classic", "aluminium_modern", "minimal_mono", "executive_blueprint"]).default("industrial_classic"),
    portal_logo_url: optionalText,
    portal_banner_url: optionalText,
    custom_domain: optionalDomain,
    default_email_signature: optionalText,
    default_whatsapp_signature: optionalText,
    footer_text: optionalText
  })
});

export const savedReportSchema = z.object({
  report_name: z.string().trim().min(3, "Report name should be at least 3 characters"),
  data_source: z.enum(["customers", "quotes", "orders", "dispatches", "invoices", "payments", "expenses", "expense_payments", "inventory", "production_jobs", "scrap_records", "dies", "quality_tests", "vendors", "purchases", "packaging_material_purchases"]),
  selected_fields: z.array(z.string().trim()).min(1, "Select at least one field"),
  filters: z.array(z.object({ field: z.string().trim(), operator: z.enum(["equals", "contains", "gt", "lt", "between"]), value: z.string().trim() })).default([]),
  grouping: z.string().trim().nullable().optional(),
  date_range: z.object({ from: z.string().trim().nullable().optional(), to: z.string().trim().nullable().optional() }).default({ from: null, to: null }),
  visibility: z.enum(["private", "company", "owner_only"]).default("private")
});

export const automationRuleSchema = z.object({
  rule_name: z.string().trim().min(3, "Rule name should be at least 3 characters"),
  trigger_type: z.enum(["quote_created", "quote_sent", "quote_expiring", "quote_approved", "order_created", "order_delayed", "dispatch_created", "invoice_overdue", "inventory_low", "quality_failed", "die_high_rejection", "complaint_created"]),
  conditions_json: z.record(z.any()).default({}),
  actions_json: z.array(z.object({ type: z.enum(["create_task", "create_alert", "generate_message", "assign_user", "change_status"]), config: z.record(z.any()).default({}) })).min(1, "Add at least one action"),
  is_active: z.coerce.boolean().default(true)
});

export const dataRetentionSettingsSchema = z.object({
  soft_delete_retention_days: z.coerce.number().int().min(7).max(3650).default(90),
  export_retention_days: z.coerce.number().int().min(7).max(3650).default(180),
  audit_log_retention_days: z.coerce.number().int().min(30).max(3650).default(365),
  auto_purge_enabled: z.coerce.boolean().default(false)
});

export const onboardingSchema = z.object({
  full_name: z.string().trim().min(1, "Your name is required"),
  phone: indianPhone,
  name: z.string().trim().min(1, "Company name is required"),
  legal_name: optionalText,
  gst_number: gstNumber,
  city: optionalText,
  state: optionalText,
  billing_address: optionalText
});

export const vendorSchema = z.object({
  vendor_name: z.string().trim().min(1, "Vendor name is required"),
  vendor_type: z.enum(["aluminum_ingot", "aluminum_sows", "aluminum_billets", "aluminum_wire_rods", "aluminum_t_ingots", "aluminum_chips", "die_maker", "powder_coating", "anodizing", "hardware_supplier", "transporter", "packing_supplier", "maintenance", "other"]),
  contact_person: optionalText,
  phone: indianPhone,
  email: optionalEmail,
  gst_number: gstNumber,
  address: optionalText,
  city: optionalText,
  state: optionalText,
  payment_terms: optionalText,
  notes: optionalText,
  is_active: z.coerce.boolean().default(true)
});

export const inventoryItemSchema = z.object({
  item_code: z.string().trim().min(1, "Item code is required"),
  item_name: z.string().trim().min(1, "Item name is required"),
  item_category: z.enum(["billets", "extruded_profiles", "hardware", "powder_coating_material", "packing_material", "scrap", "finished_goods"]),
  unit: z.string().trim().min(1, "Unit is required"),
  reorder_level: z.coerce.number().nonnegative().default(0),
  location: optionalText,
  is_active: z.coerce.boolean().default(true)
});

export const machineSchema = z.object({
  machine_code: optionalText,
  machine_name: z.string().trim().min(1, "Machine name is required"),
  machine_type: z.enum(["extrusion_press", "aging_oven", "powder_coating_line", "anodizing_line", "cutting_machine", "packing_station", "other"]),
  press_capacity_ton: z.coerce.number().nonnegative().optional().nullable(),
  status: z.enum(["active", "maintenance", "breakdown", "idle"]).default("active"),
  manufacturer: optionalText,
  purchase_date: optionalText,
  maintenance_connected: z.coerce.boolean().default(false),
  location: optionalText,
  notes: optionalText,
  is_active: z.coerce.boolean().default(true)
});

export const productionJobSchema = z.object({
  job_number: optionalText,
  order_id: z.string().uuid("Select an order"),
  profile_id: z.string().uuid("Select a profile"),
  die_id: z.string().uuid("Select a die"),
  machine_id: z.string().uuid("Select a machine").optional().nullable(),
  planned_quantity_kg: z.coerce.number().positive("Planned quantity must be positive"),
  pieces: z.coerce.number().int().nonnegative("Pieces cannot be negative").default(0),
  required_billet_count: z.coerce.number().int().nonnegative("Required billets cannot be negative").default(0),
  extrusion_efficiency_percent: z.coerce.number().positive("Efficiency must be positive").max(100, "Efficiency cannot exceed 100%").default(75),
  length_per_piece_m: z.coerce.number().positive("Length per piece must be positive").optional().nullable(),
  planned_date: optionalText,
  shift: optionalText,
  operator_name: optionalText,
  status: z.enum(["planned", "ready", "in_progress", "completed", "on_hold", "cancelled"]).default("planned"),
  remarks: optionalText
});

export const foundryBatchSchema = z.object({
  batch_number: optionalText,
  furnace_number: z.string().trim().min(1, "Furnace number is required"),
  furnace_name: optionalText,
  batch_sequence: z.coerce.number().int().positive("Batch number is required").default(1),
  order_id: z.string().uuid("Select an order").optional().nullable().or(z.literal("")),
  production_date: optionalText,
  scrap_id: z.string().uuid("Select a scrap batch").optional().nullable().or(z.literal("")),
  external_source_id: z.string().uuid("Select an external aluminium source").optional().nullable().or(z.literal("")),
  scrap_percentage: z.coerce.number().nonnegative("Scrap percentage cannot be negative").max(100, "Scrap percentage cannot exceed 100").default(0),
  external_aluminium_percentage: z.coerce.number().nonnegative("External aluminium percentage cannot be negative").max(100, "External aluminium percentage cannot exceed 100").default(100),
  furnace_efficiency_percent: z.coerce.number().positive("Furnace efficiency must be positive").max(100, "Furnace efficiency cannot exceed 100").default(80),
  required_furnace_charge_kg: z.coerce.number().nonnegative().default(0),
  scrap_aluminium_kg: z.coerce.number().nonnegative("Scrap aluminium cannot be negative").default(0),
  external_aluminium_kg: z.coerce.number().nonnegative("External aluminium cannot be negative").default(0),
  ingot_kg: z.coerce.number().nonnegative("Ingot cannot be negative").default(0),
  alloy: z.string().trim().min(1, "Alloy is required"),
  temper: z.string().trim().min(1, "Temper is required"),
  alloy_density_kg_m3: z.coerce.number().positive("Alloy density is required").default(2700),
  billet_length_mm: z.coerce.number().positive("Billet length is required"),
  billet_diameter_mm: z.coerce.number().positive("Billet diameter is required"),
  billet_diameter_inch: z.coerce.number().positive("Billet diameter is required"),
  billet_count: z.coerce.number().int().positive("Billet count is required"),
  status: z.enum(["planned", "melting", "cast", "homogenizing", "ready", "issued", "cancelled"]).default("planned"),
  alloy_composition_default: z.record(z.any()).default({}),
  alloy_composition_actual: z.record(z.any()).default({}),
  alloy_composition_altered: z.coerce.boolean().default(false),
  alloy_composition_source: optionalText,
  heat_number: optionalText,
  notes: optionalText
}).superRefine((value, ctx) => {
  if (Math.abs(value.scrap_percentage + value.external_aluminium_percentage - 100) > 0.001) {
    ctx.addIssue({ code: "custom", path: ["external_aluminium_percentage"], message: "Scrap % and external aluminium % must total 100" });
  }
});

export const externalAluminiumSourceSchema = z.object({
  source_number: optionalText,
  item_type: z.enum(["aluminum_ingot", "aluminum_sows", "aluminum_billets", "aluminum_wire_rods", "aluminum_t_ingots", "aluminum_chips"]),
  weight_kg: z.coerce.number().positive("Weight is required"),
  unit: z.string().trim().min(1).default("kg"),
  rate: z.coerce.number().nonnegative("Rate cannot be negative").default(0),
  base_amount: z.coerce.number().nonnegative("Base amount cannot be negative").default(0),
  tax_amount: z.coerce.number().nonnegative("Tax amount cannot be negative").default(0),
  freight_amount: z.coerce.number().nonnegative("Freight amount cannot be negative").default(0),
  discount_amount: z.coerce.number().nonnegative("Discount amount cannot be negative").default(0),
  total_amount: z.coerce.number().nonnegative("Total amount cannot be negative").default(0),
  invoice_number: optionalText,
  invoice_date: optionalText,
  due_date: optionalText,
  payment_status: z.enum(["unpaid", "partially_paid", "paid", "overdue", "cancelled", "reversed"]).default("unpaid"),
  payment_method: optionalText,
  quantity: z.coerce.number().positive("Quantity is required unless item is chips").optional().nullable(),
  vendor_id: z.string().uuid("Select vendor").optional().nullable().or(z.literal("")),
  source_origin: z.string().trim().min(1, "Source origin is required"),
  received_date: optionalText,
  alloy: optionalText,
  quality_grade: optionalText,
  status: z.enum(["available", "reserved", "used", "rejected", "returned"]).default("available"),
  notes: optionalText
}).superRefine((value, ctx) => {
  if (value.item_type !== "aluminum_chips" && !value.quantity) {
    ctx.addIssue({ code: "custom", path: ["quantity"], message: "Quantity is required for ingot, sows, billets, wire rods, and T-ingots" });
  }
});

export const aluminiumScrapSchema = z.object({
  scrap_number: optionalText,
  scrap_source: z.enum(["incoming", "in_house"]),
  weight_kg: z.coerce.number().positive("Scrap weight is required"),
  unit: z.string().trim().min(1).default("kg"),
  rate: z.coerce.number().nonnegative("Rate cannot be negative").default(0),
  base_amount: z.coerce.number().nonnegative("Base amount cannot be negative").default(0),
  tax_amount: z.coerce.number().nonnegative("Tax amount cannot be negative").default(0),
  freight_amount: z.coerce.number().nonnegative("Freight amount cannot be negative").default(0),
  discount_amount: z.coerce.number().nonnegative("Discount amount cannot be negative").default(0),
  total_amount: z.coerce.number().nonnegative("Total amount cannot be negative").default(0),
  invoice_number: optionalText,
  invoice_date: optionalText,
  due_date: optionalText,
  payment_status: z.enum(["unpaid", "partially_paid", "paid", "overdue", "cancelled", "reversed"]).default("unpaid"),
  payment_method: optionalText,
  available_weight_kg: z.coerce.number().nonnegative("Available scrap cannot be negative").optional().nullable(),
  vendor_id: z.string().uuid("Select vendor").optional().nullable().or(z.literal("")),
  scrap_quality: z.enum(["clean", "painted", "mixed", "contaminated", "segregation_required", "rejected"]),
  received_date: optionalText,
  origin_reference: optionalText,
  status: z.enum(["available", "reserved", "used", "rejected"]).default("available"),
  notes: optionalText
}).superRefine((value, ctx) => {
  if (value.scrap_source === "incoming" && !value.vendor_id) {
    ctx.addIssue({ code: "custom", path: ["vendor_id"], message: "Vendor is required for incoming scrap" });
  }
});

export const packagingMaterialSchema = z.object({
  material_code: optionalText,
  material_name: z.string().trim().min(1, "Material name is required"),
  material_type: z.enum(["stretch_film", "bubble_wrap", "paper", "hdpe", "pp_woven_sheet", "wooden_crate", "strapping", "corner_protector", "other"]),
  unit: z.string().trim().min(1, "Unit is required"),
  current_stock: z.coerce.number().nonnegative("Stock cannot be negative"),
  reorder_level: z.coerce.number().nonnegative("Reorder level cannot be negative"),
  calculation_method: z.enum(["per_profile_meter", "per_piece", "per_kg", "fixed"]).default("per_profile_meter"),
  consumption_rate: z.coerce.number().positive("Consumption rate is required"),
  vendor_id: z.string().uuid("Select vendor").optional().nullable().or(z.literal("")),
  location: optionalText,
  is_active: z.coerce.boolean().default(true)
});

export const packagingMaterialPurchaseSchema = z.object({
  purchase_number: optionalText,
  material_id: z.string().uuid("Select packaging material"),
  vendor_id: z.string().uuid("Select vendor"),
  received_date: optionalText,
  quantity: z.coerce.number().positive("Quantity must be greater than zero"),
  unit: z.string().trim().min(1, "Unit is required"),
  rate: z.coerce.number().nonnegative("Rate cannot be negative").default(0),
  base_amount: z.coerce.number().nonnegative("Base amount cannot be negative").default(0),
  tax_amount: z.coerce.number().nonnegative("Tax amount cannot be negative").default(0),
  freight_amount: z.coerce.number().nonnegative("Freight amount cannot be negative").default(0),
  discount_amount: z.coerce.number().nonnegative("Discount amount cannot be negative").default(0),
  total_amount: z.coerce.number().nonnegative("Total amount cannot be negative").default(0),
  invoice_number: optionalText,
  invoice_date: optionalText,
  due_date: optionalText,
  payment_status: z.enum(["unpaid", "partially_paid", "paid", "overdue", "cancelled", "reversed"]).default("unpaid"),
  payment_method: optionalText,
  notes: optionalText
});

export const packagingJobSchema = z.object({
  packaging_number: optionalText,
  order_id: z.string().uuid("Select an order"),
  production_job_id: z.string().uuid("Select a completed production job"),
  scheduled_date: optionalText,
  pieces: z.coerce.number().int().nonnegative("Pieces cannot be negative").default(0),
  profile_weight_kg: z.coerce.number().nonnegative("Weight cannot be negative").default(0),
  profile_length_m: z.coerce.number().nonnegative("Length cannot be negative").default(0),
  status: z.enum(["scheduled", "in_progress", "completed", "cancelled"]).default("scheduled"),
  notes: optionalText
});

export const packagingJobMaterialSchema = z.object({
  job_id: z.string().uuid("Select packaging job"),
  material_id: z.string().uuid("Select packaging material"),
  quantity_required: z.coerce.number().nonnegative("Quantity cannot be negative").default(1)
});

export const qualityInspectionSchema = z.object({
  production_job_id: z.string().uuid("Select a completed production job"),
  finishing_job_id: z.string().uuid("Select a completed finishing job").optional().nullable().or(z.literal("")),
  profile_id: z.string().uuid("Select a profile"),
  inspection_date: z.string().min(1, "Inspection date is required"),
  batch_number: optionalText,
  quantity_checked_kg: z.coerce.number().nonnegative(),
  dimensional_variance: optionalText,
  hardness_webster: z.coerce.number().positive().max(30, "Hardness Webster scale is typically 0-20").optional().nullable(),
  surface_finish_ok: z.coerce.boolean().default(true),
  weight_per_meter_actual: z.coerce.number().positive().optional().nullable(),
  status: z.enum(["pending", "approved", "rejected", "rework"]).default("pending"),
  inspector_name: optionalText,
  notes: optionalText
});

export const packingListItemSchema = z.object({
  dispatch_id: z.string().uuid("Select a dispatch"),
  profile_id: z.string().uuid("Select a profile"),
  bundle_number: z.string().trim().min(1, "Bundle number is required"),
  number_of_pieces: z.coerce.number().int().positive(),
  gross_weight_kg: z.coerce.number().positive(),
  tare_weight_kg: z.coerce.number().nonnegative().default(0),
  notes: optionalText
});

export const invoiceSchema = z.object({
  customer_id: z.string().uuid("Select a customer"),
  order_id: z.string().uuid().optional().nullable(),
  dispatch_id: z.string().uuid().optional().nullable(),
  invoice_number: optionalText,
  invoice_date: z.string().min(1, "Invoice date is required"),
  due_date: optionalText,
  subtotal: z.coerce.number().nonnegative(),
  tax_total: z.coerce.number().nonnegative(),
  grand_total: z.coerce.number().nonnegative(),
  amount_paid: z.coerce.number().nonnegative().default(0),
  status: z.enum(["draft", "generated", "sent", "partially_paid", "paid", "overdue", "cancelled"]).default("draft"),
  notes: optionalText
});

export const paymentSchema = z.object({
  invoice_id: z.string().uuid("Select an invoice").optional().nullable().or(z.literal("")),
  order_id: z.string().uuid("Select an order").optional().nullable().or(z.literal("")),
  payment_date: z.string().min(1, "Payment date is required"),
  amount: z.coerce.number().positive("Amount must be greater than zero"),
  payment_method: z.enum(["bank_transfer", "upi", "cheque", "cash", "credit_note", "other"]),
  payment_type: z.enum(["CUSTOMER_TO_DEALER", "DEALER_TO_FACTORY", "ADVANCE_PAYMENT", "PARTIAL_PAYMENT", "FINAL_PAYMENT", "REFUND", "ADJUSTMENT"]).optional().nullable(),
  payment_status: z.enum(["PENDING", "PAID", "PARTIALLY_PAID", "FAILED", "REFUNDED", "CANCELLED"]).default("PENDING"),
  reference_number: optionalText,
  notes: optionalText
});

export const expenseLedgerSchema = z.object({
  source_module: z.string().trim().min(1).default("manual"),
  source_submodule: optionalText,
  source_table: optionalText,
  source_record_id: z.string().uuid().optional().nullable().or(z.literal("")),
  source_label: optionalText,
  expense_category: z.string().trim().min(1, "Expense category is required"),
  expense_subcategory: optionalText,
  vendor_id: z.string().uuid("Select a vendor").optional().nullable().or(z.literal("")),
  description: z.string().trim().min(1, "Description is required"),
  quantity: z.coerce.number().nonnegative("Quantity cannot be negative").default(0),
  unit: optionalText,
  rate: z.coerce.number().nonnegative("Rate cannot be negative").default(0),
  base_amount: z.coerce.number().nonnegative("Base amount cannot be negative").default(0),
  tax_amount: z.coerce.number().nonnegative("Tax amount cannot be negative").default(0),
  freight_amount: z.coerce.number().nonnegative("Freight amount cannot be negative").default(0),
  discount_amount: z.coerce.number().nonnegative("Discount amount cannot be negative").default(0),
  total_amount: z.coerce.number().nonnegative("Total amount cannot be negative").default(0),
  currency: z.enum(["INR", "USD", "EUR", "AED", "GBP", "other"]).default("INR"),
  payment_status: z.enum(["unpaid", "partially_paid", "paid", "overdue", "cancelled", "reversed"]).default("unpaid"),
  payment_method: optionalText,
  invoice_number: optionalText,
  invoice_date: optionalText,
  due_date: optionalText,
  paid_date: optionalText,
  cost_center: optionalText,
  department: optionalText,
  machine_id: z.string().uuid("Select a machine").optional().nullable().or(z.literal("")),
  inventory_item_id: z.string().uuid("Select an inventory item").optional().nullable().or(z.literal("")),
  maintenance_record_id: z.string().uuid().optional().nullable().or(z.literal("")),
  approval_status: z.enum(["draft", "pending_approval", "approved", "rejected", "paid", "cancelled", "reversed"]).default("draft"),
  notes: optionalText
}).superRefine((value, ctx) => {
  const landedTotal = Number(value.base_amount ?? 0) + Number(value.tax_amount ?? 0) + Number(value.freight_amount ?? 0) - Number(value.discount_amount ?? 0);
  if (Number(value.total_amount ?? 0) <= 0 && landedTotal > 0) {
    ctx.addIssue({ code: "custom", path: ["total_amount"], message: "Total amount should include base, tax, freight, and discount impact." });
  }
});

export const expensePaymentSchema = z.object({
  expense_ledger_id: z.string().uuid("Select an expense"),
  payment_date: z.string().min(1, "Payment date is required"),
  amount_paid: z.coerce.number().positive("Paid amount must be greater than zero"),
  payment_method: optionalText,
  bank_account: optionalText,
  reference_number: optionalText,
  notes: optionalText
});

export const branchSchema = z.object({
  branch_name: z.string().trim().min(1, "Branch name is required"),
  branch_type: z.enum(["head_office", "factory", "warehouse", "sales_office", "depot", "dealer_location"]),
  address: optionalText,
  city: optionalText,
  state: optionalText,
  pincode: optionalText,
  phone: indianPhone,
  manager_name: optionalText,
  is_active: z.coerce.boolean().default(true)
});

export const featureFlagSchema = z.object({
  module_name: z.enum(["ai_assistant", "whatsapp_automation", "dealer_portal", "advanced_inventory", "production_planning", "quality_compliance", "export_docs", "tender_management", "energy_monitoring", "machine_maintenance", "bis_compliance", "profitability_intelligence", "barcode_tracking", "accounting_integrations", "mobile_floor_app", "multi_plant", "systems_configurator", "document_intelligence", "die_intelligence", "crm", "report_builder", "automation", "command_center"]),
  is_enabled: z.coerce.boolean().default(false),
  config_json: z.string().optional().transform((value, ctx) => {
    if (!value?.trim()) return {};
    try {
      return JSON.parse(value);
    } catch {
      ctx.addIssue({ code: "custom", message: "Config must be valid JSON" });
      return z.NEVER;
    }
  })
});

export const notificationSchema = z.object({
  recipient_user_id: z.string().uuid().optional().nullable().or(z.literal("")),
  notification_type: z.string().trim().min(1).default("system"),
  severity: z.enum(["info", "success", "warning", "critical"]).default("info"),
  title: z.string().trim().min(1, "Notification title is required"),
  body: optionalText,
  related_entity_type: optionalText,
  related_entity_id: z.string().uuid().optional().nullable().or(z.literal("")),
  is_read: z.coerce.boolean().default(false)
});

export const taskSchema = z.object({
  task_type: z.string().trim().min(1).default("general"),
  title: z.string().trim().min(1, "Task title is required"),
  description: optionalText,
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  status: z.enum(["open", "in_progress", "completed", "cancelled"]).default("open"),
  assigned_to: z.string().uuid().optional().nullable().or(z.literal("")),
  due_date: optionalText,
  related_entity_type: optionalText,
  related_entity_id: z.string().uuid().optional().nullable().or(z.literal(""))
});

export const dataExchangeJobSchema = z.object({
  job_type: z.enum(["import", "export"]),
  module_name: z.string().trim().min(1, "Module name is required"),
  status: z.enum(["queued", "running", "completed", "failed", "cancelled"]).default("queued"),
  file_url: optionalText,
  error_message: optionalText
});

export const userInvitationSchema = z.object({
  email: optionalEmail.refine((value) => Boolean(value), "Email is required"),
  full_name: optionalText,
  role: z.enum(["owner", "admin", "sales_manager", "sales", "production_manager", "production", "dispatch_manager", "dispatch", "accounts", "quality", "viewer"]),
  branch_id: z.string().uuid().optional().nullable().or(z.literal("")),
  expires_at: optionalText
});

export const userManagementSchema = z.object({
  role: z.enum(["owner", "admin", "sales_manager", "sales", "production_manager", "production", "dispatch_manager", "dispatch", "accounts", "quality", "viewer"]),
  branch_id: z.string().uuid().optional().nullable().or(z.literal("")),
  is_active: z.coerce.boolean()
});

export const quotationAssistantSchema = z.object({
  input_text: z.string().trim().min(12, "Describe the customer requirement in at least 12 characters").max(5000, "Keep the request under 5000 characters"),
  source_type: z.enum(["natural_language", "whatsapp_message", "drawing_note", "past_quote", "manual"]).default("natural_language")
});
