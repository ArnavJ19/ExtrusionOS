/**
 * PCDA Field Set and Tab Assignment
 * 
 * Defines the canonical field set and assigns each field to exactly one tab.
 * This map is shared by all modules to ensure field-set identity.
 */

import type { TechnicalLineItem, Tab } from "./types";

/**
 * The canonical list of all Technical Line Item fields.
 * Used to assert identity across modules (no field added or omitted).
 */
export const TECHNICAL_LINE_ITEM_FIELDS: readonly (keyof TechnicalLineItem)[] = [
  // Identity
  "id",
  "company_id",
  "source_record_id",
  "source_line_id",

  // Basic tab
  "section_number",
  "section_code",
  "section_name",
  "customer_component_code",
  "component_description",
  "drawing_document_id",
  "drawing_revision",
  "drawing_approval_status",
  "alloy_standard_id",
  "alloy_id",
  "temper_id",

  // Technical tab
  "cl_uom",
  "cl_per_uom",
  "cl_meter",
  "order_uom",
  "order_quantity",
  "quantity_kg",
  "section_weight_kg_per_m",
  "min_weight",
  "max_weight",
  "weight_tolerance",
  "quantity_calculation_method",
  "packing_mode_id",
  "invoice_calc_uom",
  "standard_length",
  "cut_length",
  "bundle_quantity",
  "pieces_per_m_per_kg_per_bundle",
  "packing_instruction",
  "customer_packing_requirement",

  // Commercial tab
  "material_price",
  "value_added_service_price",
  "other_charges",
  "basic_price",
  "packing_charge",
  "freight_charge",
  "alloy_surcharge_per_kg",
  "re_cutting_charge_per_kg",
  "testing_service_charge_per_kg",
  "die_cost",
  "die_service_charge",
  "packing_in_conversion",
  "include_packing_in_basic",
  "gst_percent",
  "discount",
  "margin",
  "net_rate",
  "final_line_value",

  // Costing tab
  "input_billet_weight",
  "output_good_weight",
  "rejected_weight",
  "rework_weight",
  "packing_weight",
  "freight_weight",
  "theoretical_weight",
  "actual_weight",
  "internal_cost",
  "supplier_rate",
  "internal_note",

  // Audit
  "revision_number",
] as const;

/**
 * Tab assignment for each field. Every field in TECHNICAL_LINE_ITEM_FIELDS
 * is assigned to exactly one tab. The partition covers the full field set.
 *
 * Tabs render left-to-right: Basic, Technical, Commercial, Costing, Quality,
 * Documents, Reports, Audit. (Req 5.3, 5.4)
 */
export const FIELD_TAB: Record<keyof TechnicalLineItem, Tab> = {
  // Identity / reuse fields → Basic tab
  id: "Basic",
  company_id: "Basic",
  source_record_id: "Basic",
  source_line_id: "Basic",

  // Section & Alloy details → Basic tab
  section_number: "Basic",
  section_code: "Basic",
  section_name: "Basic",
  customer_component_code: "Basic",
  component_description: "Basic",
  drawing_document_id: "Basic",
  drawing_revision: "Basic",
  drawing_approval_status: "Basic",
  alloy_standard_id: "Basic",
  alloy_id: "Basic",
  temper_id: "Basic",

  // Technical measurements / quantities → Technical tab
  cl_uom: "Technical",
  cl_per_uom: "Technical",
  cl_meter: "Technical",
  order_uom: "Technical",
  order_quantity: "Technical",
  quantity_kg: "Technical",
  section_weight_kg_per_m: "Technical",
  min_weight: "Technical",
  max_weight: "Technical",
  weight_tolerance: "Technical",
  quantity_calculation_method: "Technical",
  packing_mode_id: "Technical",
  invoice_calc_uom: "Technical",
  standard_length: "Technical",
  cut_length: "Technical",
  bundle_quantity: "Technical",
  pieces_per_m_per_kg_per_bundle: "Technical",
  packing_instruction: "Technical",
  customer_packing_requirement: "Technical",

  // Price & charges → Commercial tab
  material_price: "Commercial",
  value_added_service_price: "Commercial",
  other_charges: "Commercial",
  basic_price: "Commercial",
  packing_charge: "Commercial",
  freight_charge: "Commercial",
  alloy_surcharge_per_kg: "Commercial",
  re_cutting_charge_per_kg: "Commercial",
  testing_service_charge_per_kg: "Commercial",
  die_cost: "Commercial",
  die_service_charge: "Commercial",
  packing_in_conversion: "Commercial",
  include_packing_in_basic: "Commercial",
  gst_percent: "Commercial",
  discount: "Commercial",
  margin: "Commercial",
  net_rate: "Commercial",
  final_line_value: "Commercial",

  // Internal-only fields (excluded from customer sheets) → Commercial tab
  internal_cost: "Commercial",
  supplier_rate: "Commercial",
  internal_note: "Commercial",

  // Weight / cost input fields → Costing tab
  input_billet_weight: "Costing",
  output_good_weight: "Costing",
  rejected_weight: "Costing",
  rework_weight: "Costing",
  packing_weight: "Costing",
  freight_weight: "Costing",
  theoretical_weight: "Costing",
  actual_weight: "Costing",

  // Versioning → Audit tab
  revision_number: "Audit",
};
