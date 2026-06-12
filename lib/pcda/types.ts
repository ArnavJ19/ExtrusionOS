/**
 * PCDA Technical Line Item Types
 *
 * The shared technical-commercial line-item structure used identically across
 * Quote, Order, Production, Dispatch, and Invoice modules.
 *
 * Requirements: 1.1, 1.2, 2.1–2.8, 3.1–3.4, 4.5
 */

/**
 * Quantity calculation method used to derive billable quantity in kilograms.
 * - "length_weight_qty": length × section_weight_kg_per_m × quantity
 * - "theoretical": uses the recorded theoretical weight
 * - "actual": uses the recorded actual (weighed) weight
 */
export type QtyMethod = "length_weight_qty" | "theoretical" | "actual";

/**
 * Reference tracking for line reuse across modules.
 * Stamps the downstream line with identifiers of its upstream source.
 * (Req 1.4)
 */
export interface SourceRef {
  sourceRecordId: string;
  sourceLineId: string;
}

/**
 * Drawing approval status enum values.
 * (Req 2.14)
 */
export type DrawingApprovalStatus = "Pending" | "Approved" | "Rejected";

/**
 * Progressive-disclosure tabs for the Technical Line Item editor.
 * Rendered left-to-right in this order. (Req 5.3)
 */
export type Tab =
  | "Basic"
  | "Technical"
  | "Commercial"
  | "Costing"
  | "Quality"
  | "Documents"
  | "Reports"
  | "Audit";

export const TABS: readonly Tab[] = [
  "Basic",
  "Technical",
  "Commercial",
  "Costing",
  "Quality",
  "Documents",
  "Reports",
  "Audit",
] as const;

/**
 * The canonical Technical Line Item structure.
 * Every host module (quote_items, order_items, etc.) persists this identical field set.
 *
 * Grouped by progressive-disclosure tab assignment:
 * - Identity / reuse fields
 * - Basic tab: Section & Alloy details (Req 2)
 * - Technical tab (Req 2, 4)
 * - Commercial tab: Basic price & charges (Req 3)
 * - Costing tab: technical weights/costs (Req 4)
 * - Internal-only fields (excluded from customer sheets — Req 5.5, 28)
 * - Versioning (Req 22.2)
 */
export interface TechnicalLineItem {
  // identity / reuse
  id: string;
  company_id: string;
  source_record_id: string | null; // Req 1.4
  source_line_id: string | null; // Req 1.4

  // --- Basic tab: Section & Alloy details (Req 2) ---
  section_number: string | null;
  section_code: string | null;
  section_name: string | null; // ≤200 chars
  customer_component_code: string | null; // ≤200 chars
  component_description: string | null; // ≤500 chars
  drawing_document_id: string | null;
  drawing_revision: string | null;
  drawing_approval_status: DrawingApprovalStatus | null;
  alloy_standard_id: string | null; // FK -> master
  alloy_id: string | null; // FK -> master
  temper_id: string | null; // FK -> master

  // --- Technical tab (Req 2, 4) ---
  cl_uom: string | null;
  cl_per_uom: number | null;
  cl_meter: number | null;
  order_uom: string | null;
  order_quantity: number | null;
  quantity_kg: number | null;
  section_weight_kg_per_m: number | null;
  min_weight: number | null;
  max_weight: number | null;
  weight_tolerance: number | null;
  quantity_calculation_method: QtyMethod | null;
  packing_mode_id: string | null; // FK -> master
  invoice_calc_uom: string | null;
  standard_length: number | null;
  cut_length: number | null;
  bundle_quantity: number | null;
  pieces_per_m_per_kg_per_bundle: number | null;
  packing_instruction: string | null; // ≤500 chars
  customer_packing_requirement: string | null; // ≤500 chars

  // --- Commercial tab: Basic price & charges (Req 3) ---
  material_price: number | null;
  value_added_service_price: number | null;
  other_charges: number | null;
  basic_price: number | null;
  packing_charge: number | null;
  freight_charge: number | null;
  alloy_surcharge_per_kg: number | null;
  re_cutting_charge_per_kg: number | null;
  testing_service_charge_per_kg: number | null;
  die_cost: number | null;
  die_service_charge: number | null;
  packing_in_conversion: boolean; // default false
  include_packing_in_basic: boolean; // default false
  gst_percent: number | null;
  discount: number | null;
  margin: number | null; // signed
  net_rate: number | null;
  final_line_value: number | null;

  // --- Costing tab: technical weights/costs (Req 4) ---
  input_billet_weight: number | null;
  output_good_weight: number | null;
  rejected_weight: number | null;
  rework_weight: number | null;
  packing_weight: number | null;
  freight_weight: number | null;
  theoretical_weight: number | null;
  actual_weight: number | null;

  // internal-only (excluded from customer sheets — Req 5.5, 28)
  internal_cost: number | null;
  supplier_rate: number | null;
  internal_note: string | null;

  revision_number: number; // Req 22.2
}
