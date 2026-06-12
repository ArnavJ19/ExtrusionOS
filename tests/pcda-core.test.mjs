import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { TECHNICAL_LINE_ITEM_FIELDS, FIELD_TAB } from "../lib/pcda/field-map.ts";
import { TABS } from "../lib/pcda/types.ts";
import { copyLineForReuse, hasCompleteFieldSet } from "../lib/pcda/line-item.ts";
import { mapCalcResultToDisplay, mapNullableToDisplay, MISSING_COST_LABEL, NOT_CAPTURED_LABEL } from "../lib/pcda/labels.ts";
import { sanitizeForCustomer, isRestrictedField } from "../lib/pcda/sanitize.ts";
import { NOT_CAPTURED } from "../lib/calculations/pcda/sentinel.ts";
import { technicalLineItemSchema } from "../lib/validations/pcda/line-item.ts";
import {
  canApproveProfile,
  canConvertQuoteToOrder,
  canDispatchWithQualityStatus,
  canUseDieForProduction,
  isProductionRouteComplete,
} from "../lib/workflow/pcda/gates.ts";

const uuid = "11111111-1111-4111-8111-111111111111";
const companyId = "22222222-2222-4222-8222-222222222222";

function completeLine(overrides = {}) {
  const line = {};
  for (const field of TECHNICAL_LINE_ITEM_FIELDS) {
    line[field] = null;
  }

  return {
    ...line,
    id: uuid,
    company_id: companyId,
    packing_in_conversion: false,
    include_packing_in_basic: false,
    revision_number: 3,
    section_number: "SEC-1001",
    section_name: "2 Track Window Frame",
    section_weight_kg_per_m: 0.84,
    order_quantity: 50,
    min_weight: 0.82,
    max_weight: 0.86,
    material_price: 260.5,
    margin: 12.25,
    internal_cost: 240,
    supplier_rate: 230,
    internal_note: "Factory-only margin note",
    ...overrides,
  };
}

describe("PCDA field set", () => {
  it("assigns every canonical field to exactly one valid tab", () => {
    assert.equal(new Set(TECHNICAL_LINE_ITEM_FIELDS).size, TECHNICAL_LINE_ITEM_FIELDS.length);

    for (const field of TECHNICAL_LINE_ITEM_FIELDS) {
      assert.ok(Object.hasOwn(FIELD_TAB, field), `${field} is missing from FIELD_TAB`);
      assert.ok(TABS.includes(FIELD_TAB[field]), `${field} has invalid tab ${FIELD_TAB[field]}`);
    }

    assert.equal(Object.keys(FIELD_TAB).length, TECHNICAL_LINE_ITEM_FIELDS.length);
  });

  it("uses the combined pieces_per_m_per_kg_per_bundle field", () => {
    assert.ok(TECHNICAL_LINE_ITEM_FIELDS.includes("pieces_per_m_per_kg_per_bundle"));
  });
});

describe("PCDA line reuse and missing labels", () => {
  it("copies the canonical field set, preserves nulls, stamps source, and keeps source immutable", () => {
    const source = completeLine({ source_record_id: null, source_line_id: null, alloy_id: null });
    const copy = copyLineForReuse(source, { sourceRecordId: "33333333-3333-4333-8333-333333333333", sourceLineId: uuid });

    assert.equal(hasCompleteFieldSet(copy), true);
    assert.equal(copy.alloy_id, null);
    assert.equal(copy.source_record_id, "33333333-3333-4333-8333-333333333333");
    assert.equal(copy.source_line_id, uuid);
    assert.equal(copy.revision_number, 1);
    assert.equal(source.source_record_id, null);
    assert.equal(source.revision_number, 3);
  });

  it("maps absent calculation and nullable values to explicit labels", () => {
    assert.equal(mapCalcResultToDisplay(NOT_CAPTURED, MISSING_COST_LABEL), MISSING_COST_LABEL);
    assert.equal(mapCalcResultToDisplay(42), 42);
    assert.equal(mapNullableToDisplay(null), NOT_CAPTURED_LABEL);
    assert.equal(mapNullableToDisplay("6063"), "6063");
  });
});

describe("PCDA validation", () => {
  it("accepts a valid technical line payload and defaults packing flags", () => {
    const parsed = technicalLineItemSchema.parse({
      section_name: "Door Sash",
      component_description: "Customer-approved extrusion section",
      drawing_approval_status: "Pending",
      order_quantity: 10,
      section_weight_kg_per_m: 0.67,
      min_weight: 0.65,
      max_weight: 0.69,
      material_price: 250.25,
      gst_percent: 18,
    });

    assert.equal(parsed.packing_in_conversion, false);
    assert.equal(parsed.include_packing_in_basic, false);
    assert.equal(parsed.revision_number, 1);
  });

  it("rejects invalid text length, weight range, money precision, enum, and packing flags", () => {
    assert.equal(technicalLineItemSchema.safeParse({ component_description: "x".repeat(501) }).success, false);
    assert.equal(technicalLineItemSchema.safeParse({ min_weight: 1.2, max_weight: 1.1 }).success, false);
    assert.equal(technicalLineItemSchema.safeParse({ material_price: 10.123 }).success, false);
    assert.equal(technicalLineItemSchema.safeParse({ drawing_approval_status: "Draft" }).success, false);
    assert.equal(
      technicalLineItemSchema.safeParse({ include_packing_in_basic: true, packing_in_conversion: true }).success,
      false
    );
  });

  it("rejects negative or zero technical quantities where positive values are required", () => {
    assert.equal(technicalLineItemSchema.safeParse({ section_weight_kg_per_m: 0 }).success, false);
    assert.equal(technicalLineItemSchema.safeParse({ order_quantity: -1 }).success, false);
    assert.equal(technicalLineItemSchema.safeParse({ weight_tolerance: -0.01 }).success, false);
  });
});

describe("PCDA customer sanitization and workflow gates", () => {
  it("omits restricted internal commercial fields from customer-facing lines", () => {
    const sanitized = sanitizeForCustomer(completeLine());

    assert.equal(isRestrictedField("internal_cost"), true);
    assert.equal(Object.hasOwn(sanitized, "internal_cost"), false);
    assert.equal(Object.hasOwn(sanitized, "supplier_rate"), false);
    assert.equal(Object.hasOwn(sanitized, "margin"), false);
    assert.equal(Object.hasOwn(sanitized, "internal_note"), false);
    assert.equal(sanitized.section_number, "SEC-1001");
  });

  it("blocks gated actions unless the precondition holds or owner override exists", () => {
    assert.equal(canApproveProfile(false).allowed, false);
    assert.equal(canApproveProfile(false, true).allowed, true);
    assert.equal(canUseDieForProduction("blocked").allowed, false);
    assert.equal(canUseDieForProduction("blocked", true).allowed, true);
    assert.equal(canConvertQuoteToOrder("Pending").allowed, false);
    assert.equal(canConvertQuoteToOrder("Approved").allowed, true);
    assert.equal(isProductionRouteComplete(0).allowed, false);
    assert.equal(isProductionRouteComplete(1).allowed, true);
    assert.equal(canDispatchWithQualityStatus("pending").allowed, false);
    assert.equal(canDispatchWithQualityStatus("approved").allowed, true);
  });
});
