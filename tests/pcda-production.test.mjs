import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildProductionJobPcdaFields, chooseProductionSourceLine } from "../lib/pcda/production.ts";

describe("PCDA production handoff", () => {
  it("copies canonical order line fields onto production jobs and stamps source line", () => {
    const source = {
      id: "line-1",
      company_id: "wrong-company",
      order_id: "order-1",
      quote_id: "quote-1",
      section_number: "SN-100",
      section_code: "SC-100",
      section_name: "Sliding Sash",
      drawing_approval_status: "Approved",
      quantity_kg: 125.75,
      section_weight_kg_per_m: 1.25,
      material_price: 245,
      final_line_value: 42000,
      non_pcda_field: "ignored"
    };

    const copied = buildProductionJobPcdaFields(source, "company-1");

    assert.equal(copied.company_id, "company-1");
    assert.equal(copied.source_record_id, "order-1");
    assert.equal(copied.source_line_id, "line-1");
    assert.equal(copied.section_number, "SN-100");
    assert.equal(copied.quantity_kg, 125.75);
    assert.equal(copied.final_line_value, 42000);
    assert.equal(copied.non_pcda_field, undefined);
  });

  it("selects the matching profile line for production", () => {
    const lines = [{ id: "a", profile_id: "profile-a" }, { id: "b", profile_id: "profile-b" }];
    assert.equal(chooseProductionSourceLine(lines, "profile-b")?.id, "b");
    assert.equal(chooseProductionSourceLine(lines, "profile-c"), null);
  });
});
