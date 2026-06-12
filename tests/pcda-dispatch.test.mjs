import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPackingListItems } from "../lib/pcda/dispatch.ts";

describe("PCDA dispatch handoff", () => {
  it("builds packing list rows from real production job weights and PCDA snapshots", () => {
    const rows = buildPackingListItems([{
      id: "job-1",
      job_number: "J-001",
      order_id: "order-1",
      profile_id: "profile-1",
      pieces: 24,
      actual_quantity_kg: 132.5,
      section_number: "SN-42",
      section_name: "Outer Frame",
      drawing_approval_status: "Approved",
      packing_weight: 2.5,
      internal_note: "floor note"
    }], "dispatch-1", "D-2026-0001", "company-1");

    assert.equal(rows.length, 1);
    assert.equal(rows[0].company_id, "company-1");
    assert.equal(rows[0].dispatch_id, "dispatch-1");
    assert.equal(rows[0].profile_id, "profile-1");
    assert.equal(rows[0].bundle_number, "D-2026-0001-01");
    assert.equal(rows[0].number_of_pieces, 24);
    assert.equal(rows[0].gross_weight_kg, 132.5);
    assert.equal(rows[0].tare_weight_kg, 2.5);
    assert.equal(rows[0].source_line_id, "job-1");
    assert.equal(rows[0].source_record_id, "order-1");
    assert.equal(rows[0].section_name, "Outer Frame");
  });
});
