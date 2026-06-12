import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildOrderItemFromQuoteItem,
  buildQuoteItemPcdaFields,
  hasUnapprovedDrawing,
  normalizeDrawingApprovalStatus,
} from "../lib/pcda/quote-order.ts";

describe("PCDA quote/order mapping", () => {
  it("normalizes drawing approval statuses to canonical PCDA values", () => {
    assert.equal(normalizeDrawingApprovalStatus("approved"), "Approved");
    assert.equal(normalizeDrawingApprovalStatus("Rejected"), "Rejected");
    assert.equal(normalizeDrawingApprovalStatus("superseded"), "Pending");
    assert.equal(normalizeDrawingApprovalStatus(null), null);
  });

  it("builds validated PCDA fields from a real quote item and profile snapshot", () => {
    const fields = buildQuoteItemPcdaFields({
      companyId: "22222222-2222-4222-8222-222222222222",
      profile: {
        id: "11111111-1111-4111-8111-111111111111",
        profile_code: "PR-101",
        profile_name: "Two Track Frame",
        section_number: "SEC-101",
        drawing_approval_status: "approved",
        min_weight: 0.7,
        max_weight: 0.8,
        standard_length: 5.8,
      },
      item: {
        item_description: "Customer component frame",
        quantity_pieces: 20,
        length_per_piece_m: 5.8,
        section_weight_kg_per_m: 0.75,
        total_meters: 116,
        total_weight_kg: 87,
        billing_weight_kg: 87,
        billet_rate_per_kg: 250,
        raw_material_cost: 21750,
        conversion_charge_per_kg: 42,
        conversion_cost: 3654,
        finishing_charge: 0,
        finishing_cost: 0,
        die_charge: 1000,
        die_amortization_amount: 1000,
        packing_charge: 250,
        transport_charge: 500,
        other_charges: 0,
        margin_amount: 2500,
        line_total_before_gst: 30300,
        price_per_kg: 348.28,
      },
      gstPercent: 18,
      quoteRevisionNumber: 2,
    });

    assert.equal(fields.section_number, "SEC-101");
    assert.equal(fields.section_code, "PR-101");
    assert.equal(fields.drawing_approval_status, "Approved");
    assert.equal(fields.quantity_calculation_method, "length_weight_qty");
    assert.equal(fields.quantity_kg, 87);
    assert.equal(fields.final_line_value, 30300);
    assert.equal(fields.revision_number, 2);
    assert.equal(Object.hasOwn(fields, "company_id"), false);
  });

  it("copies only canonical/common fields from quote item to order item", () => {
    const orderItem = buildOrderItemFromQuoteItem(
      {
        id: "33333333-3333-4333-8333-333333333333",
        quote_id: "44444444-4444-4444-8444-444444444444",
        profile_id: "11111111-1111-4111-8111-111111111111",
        die_id: null,
        item_description: "Line",
        quantity_pieces: 10,
        length_per_piece_m: 5.8,
        total_meters: 58,
        section_number: "SEC-1",
        raw_material_cost: 999,
        created_at: "2026-06-02T00:00:00.000Z",
      },
      "55555555-5555-4555-8555-555555555555",
      "44444444-4444-4444-8444-444444444444",
      "22222222-2222-4222-8222-222222222222"
    );

    assert.equal(orderItem.order_id, "55555555-5555-4555-8555-555555555555");
    assert.equal(orderItem.source_record_id, "44444444-4444-4444-8444-444444444444");
    assert.equal(orderItem.source_line_id, "33333333-3333-4333-8333-333333333333");
    assert.equal(orderItem.section_number, "SEC-1");
    assert.equal(Object.hasOwn(orderItem, "quote_id"), false);
    assert.equal(Object.hasOwn(orderItem, "raw_material_cost"), false);
    assert.equal(Object.hasOwn(orderItem, "created_at"), false);
  });

  it("flags quote lines with missing or pending drawing approval", () => {
    assert.equal(hasUnapprovedDrawing({ drawing_approval_status: "Approved" }), false);
    assert.equal(hasUnapprovedDrawing({ drawing_approval_status: "Pending" }), true);
    assert.equal(hasUnapprovedDrawing({ drawing_approval_status: null }), true);
  });
});
