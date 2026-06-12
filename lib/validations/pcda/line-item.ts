/**
 * PCDA Technical Line Item Validation Schema
 *
 * Shared Zod schema for validating Technical_Line_Item write payloads
 * (create/update). Server-derived fields (id, company_id) are optional
 * since they are stamped server-side.
 *
 * Requirements: 2.9, 2.11, 2.12, 2.13, 2.14, 2.15, 3.5, 3.9, 3.10, 20.1, 20.2, 20.3, 20.4
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_VALUE = 999_999_999.99;

// ---------------------------------------------------------------------------
// Exported helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if `value` has at most `n` decimal places.
 * Pure function exported for property-based testing.
 *
 * Uses string-based approach to avoid floating-point drift with large numbers
 * (e.g., 71023298.15 * 100 = 7102329815.000001 would exceed a fixed tolerance).
 */
export function hasAtMostNDecimalPlaces(value: number, n: number): boolean {
  if (!Number.isFinite(value)) return false;
  if (n < 0) return false;
  // Use toFixed to get the value rounded to n decimal places, then compare
  // If the value equals its n-decimal-place representation, it has ≤n dp.
  const rounded = Number(value.toFixed(n));
  return rounded === value;
}

// ---------------------------------------------------------------------------
// Internal schema builder helpers
// ---------------------------------------------------------------------------

function nullableText(maxLength: number, fieldName: string) {
  return z
    .string()
    .max(maxLength, `${fieldName} exceeds ${maxLength} characters`)
    .nullable();
}

/**
 * Positive numeric field: numeric, > 0, ≤ MAX_VALUE.
 * Used for weight/quantity fields that don't have a decimal constraint.
 */
function nullablePositiveNumber(fieldName: string) {
  return z
    .number({
      invalid_type_error: `${fieldName} must be numeric`,
    })
    .positive(`${fieldName} must be greater than zero`)
    .max(MAX_VALUE, `${fieldName} must be no greater than ${MAX_VALUE}`)
    .nullable();
}

/**
 * Non-negative numeric field: numeric, ≥ 0, ≤ MAX_VALUE.
 * Used for weight_tolerance and costing weight fields that can be zero.
 */
function nullableNonNegativeNumber(fieldName: string) {
  return z
    .number({
      invalid_type_error: `${fieldName} must be numeric`,
    })
    .nonnegative(`${fieldName} must be zero or greater`)
    .max(MAX_VALUE, `${fieldName} must be no greater than ${MAX_VALUE}`)
    .nullable();
}

/**
 * Positive monetary/rate field: numeric, > 0, ≤ MAX_VALUE, at most 2 decimal places.
 * Requirements: 3.5 — monetary/rate fields (excluding margin).
 * Note: null represents "not captured"; zero is not a valid monetary amount.
 */
function nullablePositiveMoney(fieldName: string) {
  return z
    .number({
      invalid_type_error: `${fieldName} must be numeric`,
    })
    .positive(`${fieldName} must be greater than zero`)
    .max(MAX_VALUE, `${fieldName} must be no greater than ${MAX_VALUE}`)
    .refine(
      (value) => hasAtMostNDecimalPlaces(value, 2),
      `${fieldName} must have at most two decimal places`
    )
    .nullable();
}

/**
 * Signed monetary field (margin): numeric, −MAX_VALUE to MAX_VALUE, at most 2 decimal places.
 * Requirements: 3.10
 */
function nullableSignedMoney(fieldName: string) {
  return z
    .number({
      invalid_type_error: `${fieldName} must be numeric`,
    })
    .min(-MAX_VALUE, `${fieldName} must be no less than -${MAX_VALUE}`)
    .max(MAX_VALUE, `${fieldName} must be no greater than ${MAX_VALUE}`)
    .refine(
      (value) => hasAtMostNDecimalPlaces(value, 2),
      `${fieldName} must have at most two decimal places`
    )
    .nullable();
}

/**
 * GST percentage: numeric, 0 ≤ value ≤ 100, at most 2 decimal places.
 * Requirements: 3.9
 */
function nullableGst(fieldName: string) {
  return z
    .number({
      invalid_type_error: `${fieldName} must be numeric`,
    })
    .min(0, `${fieldName} must be zero or greater`)
    .max(100, `${fieldName} must be no greater than 100`)
    .refine(
      (value) => hasAtMostNDecimalPlaces(value, 2),
      `${fieldName} must have at most two decimal places`
    )
    .nullable();
}

// ---------------------------------------------------------------------------
// Enum schemas
// ---------------------------------------------------------------------------

export const drawingApprovalStatusSchema = z.enum(["Pending", "Approved", "Rejected"]);
export const qtyMethodSchema = z.enum(["length_weight_qty", "theoretical", "actual"]);

// ---------------------------------------------------------------------------
// Main schema — validates the WRITE payload (create/update)
// ---------------------------------------------------------------------------

const technicalLineItemBaseSchema = z.object({
    // --- Identity (server-derived, optional in write payload) ---
    id: z.string().uuid().optional(),
    company_id: z.string().uuid().optional(),
    source_record_id: z.string().uuid().nullable().optional(),
    source_line_id: z.string().uuid().nullable().optional(),

    // --- Basic tab: Section & Alloy details (Req 2) ---
    section_number: nullableText(200, "section_number").optional(),
    section_code: nullableText(200, "section_code").optional(),
    section_name: nullableText(200, "section_name").optional(),
    customer_component_code: nullableText(200, "customer_component_code").optional(),
    component_description: nullableText(500, "component_description").optional(),
    drawing_document_id: z.string().uuid().nullable().optional(),
    drawing_revision: nullableText(100, "drawing_revision").optional(),
    drawing_approval_status: drawingApprovalStatusSchema.nullable().optional(),
    alloy_standard_id: z.string().uuid().nullable().optional(),
    alloy_id: z.string().uuid().nullable().optional(),
    temper_id: z.string().uuid().nullable().optional(),

    // --- Technical tab (Req 2, 4) ---
    cl_uom: nullableText(50, "cl_uom").optional(),
    cl_per_uom: nullablePositiveNumber("cl_per_uom").optional(),
    cl_meter: nullablePositiveNumber("cl_meter").optional(),
    order_uom: nullableText(50, "order_uom").optional(),
    order_quantity: nullablePositiveNumber("order_quantity").optional(),
    quantity_kg: nullablePositiveNumber("quantity_kg").optional(),
    section_weight_kg_per_m: nullablePositiveNumber("section_weight_kg_per_m").optional(),
    min_weight: nullablePositiveNumber("min_weight").optional(),
    max_weight: nullablePositiveNumber("max_weight").optional(),
    weight_tolerance: nullableNonNegativeNumber("weight_tolerance").optional(),
    quantity_calculation_method: qtyMethodSchema.nullable().optional(),
    packing_mode_id: z.string().uuid().nullable().optional(),
    invoice_calc_uom: nullableText(50, "invoice_calc_uom").optional(),
    standard_length: nullablePositiveNumber("standard_length").optional(),
    cut_length: nullablePositiveNumber("cut_length").optional(),
    bundle_quantity: nullablePositiveNumber("bundle_quantity").optional(),
    pieces_per_m_per_kg_per_bundle: nullablePositiveNumber("pieces_per_m_per_kg_per_bundle").optional(),
    packing_instruction: nullableText(500, "packing_instruction").optional(),
    customer_packing_requirement: nullableText(500, "customer_packing_requirement").optional(),

    // --- Commercial tab: Basic price & charges (Req 3) ---
    material_price: nullablePositiveMoney("material_price").optional(),
    value_added_service_price: nullablePositiveMoney("value_added_service_price").optional(),
    other_charges: nullablePositiveMoney("other_charges").optional(),
    basic_price: nullablePositiveMoney("basic_price").optional(),
    packing_charge: nullablePositiveMoney("packing_charge").optional(),
    freight_charge: nullablePositiveMoney("freight_charge").optional(),
    alloy_surcharge_per_kg: nullablePositiveMoney("alloy_surcharge_per_kg").optional(),
    re_cutting_charge_per_kg: nullablePositiveMoney("re_cutting_charge_per_kg").optional(),
    testing_service_charge_per_kg: nullablePositiveMoney("testing_service_charge_per_kg").optional(),
    die_cost: nullablePositiveMoney("die_cost").optional(),
    die_service_charge: nullablePositiveMoney("die_service_charge").optional(),
    packing_in_conversion: z.boolean().default(false),
    include_packing_in_basic: z.boolean().default(false),
    gst_percent: nullableGst("gst_percent").optional(),
    discount: nullablePositiveMoney("discount").optional(),
    margin: nullableSignedMoney("margin").optional(),
    net_rate: nullablePositiveMoney("net_rate").optional(),
    final_line_value: nullablePositiveMoney("final_line_value").optional(),

    // --- Costing tab: technical weights/costs (Req 4) ---
    input_billet_weight: nullablePositiveNumber("input_billet_weight").optional(),
    output_good_weight: nullableNonNegativeNumber("output_good_weight").optional(),
    rejected_weight: nullableNonNegativeNumber("rejected_weight").optional(),
    rework_weight: nullableNonNegativeNumber("rework_weight").optional(),
    packing_weight: nullableNonNegativeNumber("packing_weight").optional(),
    freight_weight: nullableNonNegativeNumber("freight_weight").optional(),
    theoretical_weight: nullablePositiveNumber("theoretical_weight").optional(),
    actual_weight: nullablePositiveNumber("actual_weight").optional(),

    // --- Internal-only fields (excluded from customer sheets — Req 5.5, 28) ---
    internal_cost: nullablePositiveMoney("internal_cost").optional(),
    supplier_rate: nullablePositiveMoney("supplier_rate").optional(),
    internal_note: nullableText(1000, "internal_note").optional(),

    // --- Versioning (Req 22.2) ---
    revision_number: z.number().int().positive().default(1),
  });

function validateTechnicalLineItemConsistency(line: any, ctx: z.RefinementCtx) {
  // Req 2.12, 20.3: min_weight must not exceed max_weight
  if (
    line.min_weight !== null &&
    line.min_weight !== undefined &&
    line.max_weight !== null &&
    line.max_weight !== undefined &&
    line.min_weight > line.max_weight
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["min_weight"],
      message: "min_weight cannot exceed max_weight",
    });
  }

  // Req 3.11: packing charge cannot be included in both basic price and conversion
  if (line.include_packing_in_basic && line.packing_in_conversion) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["include_packing_in_basic"],
      message:
        "packing charge cannot be included in both basic price and conversion price",
    });
  }
}

export const technicalLineItemSchema = technicalLineItemBaseSchema.superRefine(validateTechnicalLineItemConsistency);

// ---------------------------------------------------------------------------
// Partial schema for updates (all fields optional)
// ---------------------------------------------------------------------------

export const technicalLineItemPartialSchema = technicalLineItemBaseSchema
  .partial()
  .superRefine(validateTechnicalLineItemConsistency);

// ---------------------------------------------------------------------------
// Type exports
// ---------------------------------------------------------------------------

export type TechnicalLineItemInput = z.input<typeof technicalLineItemSchema>;
export type TechnicalLineItemParsed = z.output<typeof technicalLineItemSchema>;
export type TechnicalLineItemPartialInput = z.input<typeof technicalLineItemPartialSchema>;

// ---------------------------------------------------------------------------
// Convenience parse helpers
// ---------------------------------------------------------------------------

export function validateTechnicalLineItem(
  input: TechnicalLineItemInput
): TechnicalLineItemParsed {
  return technicalLineItemSchema.parse(input);
}

export function parseTechnicalLineItem(input: TechnicalLineItemInput) {
  return technicalLineItemSchema.safeParse(input);
}
