import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPackingListItems } from "../lib/pcda/dispatch.ts";

describe("PCDA dispatch handoff", () => {
  it("builds packing list rows from real production job weights and PCDA snapshots", () => {
    const rows = buildPackingListItems([{
      id: "job-1",
      job_number: "J-001",
      order_id: "order-1",
      order_item_id: "order-line-1",
      quote_item_id: "quote-line-1",
      profile_id: "profile-1",
      finishing_type: "powder_coating",
      unit_rate: 315,
      pieces: 24,
      actual_quantity_kg: 132.5,
      section_number: "SN-42",
      section_name: "Outer Frame",
      drawing_approval_status: "Approved",
      packing_weight: 2.5,
      internal_note: "floor note"
    }], "dispatch-1", "D-2026-0001", "company-1", 132.5);

    assert.equal(rows.length, 1);
    assert.equal(rows[0].company_id, "company-1");
    assert.equal(rows[0].dispatch_id, "dispatch-1");
    assert.equal(rows[0].profile_id, "profile-1");
    assert.equal(rows[0].bundle_number, "D-2026-0001-01");
    assert.equal(rows[0].number_of_pieces, 24);
    assert.equal(rows[0].gross_weight_kg, 132.5);
    assert.equal(rows[0].tare_weight_kg, 0);
    assert.equal(rows[0].source_kind, "production");
    assert.equal(rows[0].reservation_id, null);
    assert.equal(rows[0].profile_stock_batch_id, null);
    assert.equal(rows[0].source_line_id, "job-1");
    assert.equal(rows[0].source_record_id, "order-1");
    assert.equal(rows[0].order_item_id, "order-line-1");
    assert.equal(rows[0].quote_item_id, "quote-line-1");
    assert.equal(rows[0].finishing_type, "powder_coating");
    assert.equal(rows[0].net_rate, 315);
    assert.equal(rows[0].section_name, "Outer Frame");
  });

  it("uses actual pieces rather than planned pieces for completed production", () => {
    const [row] = buildPackingListItems([{
      id: "job-actual",
      order_id: "order-1",
      profile_id: "profile-1",
      pieces: 1000,
      actual_pieces: 900,
      actual_quantity_kg: 100
    }], "dispatch-1", "D-2026-0002", "company-1", 100);

    assert.equal(row.number_of_pieces, 900);
  });

  it("uses original source weight when allocating a later partial dispatch", () => {
    const [row] = buildPackingListItems([{
      id: "job-partial",
      order_id: "order-1",
      profile_id: "profile-1",
      actual_pieces: 100,
      actual_quantity_kg: 100,
      available_weight_kg: 60
    }], "dispatch-2", "D-2026-0003", "company-1", 60);

    assert.equal(row.gross_weight_kg, 60);
    assert.equal(row.number_of_pieces, 60);
  });

  it("creates the requested physical bundles while preserving net weight and tare totals", () => {
    const rows = buildPackingListItems([{
      id: "job-bundles",
      order_id: "order-1",
      profile_id: "profile-1",
      actual_pieces: 12,
      actual_quantity_kg: 120
    }], "dispatch-3", "D-2026-0004", "company-1", 120, 3, [2, 1.5, 2.5]);

    assert.equal(rows.length, 3);
    assert.equal(rows.reduce((sum, row) => sum + row.net_weight_kg, 0), 120);
    assert.equal(rows.reduce((sum, row) => sum + row.tare_weight_kg, 0), 6);
    assert.equal(rows.reduce((sum, row) => sum + row.gross_weight_kg, 0), 126);
    assert.equal(rows.reduce((sum, row) => sum + row.number_of_pieces, 0), 12);
  });

  it("copies exact reservation and stock-batch identity to every reserved-stock bundle", () => {
    const rows = buildPackingListItems([{
      id: "reservation-1",
      reservation_id: "reservation-1",
      order_id: "order-1",
      profile_id: "profile-1",
      profile_stock_batch_id: "stock-batch-1",
      source_kind: "reservation",
      reserved_weight_kg: 50,
      actual_quantity_kg: 50,
      available_weight_kg: 50
    }], "dispatch-4", "D-2026-0005", "company-1", 50, 2, [0.4, 0.6]);

    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => row.source_kind === "reservation"));
    assert.ok(rows.every((row) => row.reservation_id === "reservation-1"));
    assert.ok(rows.every((row) => row.profile_stock_batch_id === "stock-batch-1"));
  });

  it("rejects fewer bundles than separately traceable sources", () => {
    assert.throws(() => buildPackingListItems([
      { id: "job-1", order_id: "order-1", profile_id: "profile-1", actual_quantity_kg: 20 },
      { id: "job-2", order_id: "order-1", profile_id: "profile-2", actual_quantity_kg: 20 }
    ], "dispatch-5", "D-2026-0006", "company-1", 40, 1, [0]), /At least 2 bundles/);
  });

  it("rejects a tare list that does not match the physical bundle count", () => {
    assert.throws(() => buildPackingListItems([{
      id: "job-1",
      order_id: "order-1",
      profile_id: "profile-1",
      actual_quantity_kg: 20
    }], "dispatch-6", "D-2026-0007", "company-1", 20, 2, [1]), /one tare weight for each/);
  });
});
