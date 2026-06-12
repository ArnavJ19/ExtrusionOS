import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildInvoiceItems } from "../lib/pcda/invoice.ts";

describe("Invoice item PCDA propagation", () => {
  const companyId = "comp-1";
  const invoiceId = "inv-1";

  it("propagates PCDA fields from packing_list_items", () => {
    const sourceLines = [{
      id: "packing-1",
      dispatch_id: "disp-1",
      profile_id: "profile-1",
      section_number: "SEC-001",
      section_code: "P-100",
      section_name: "Sliding Track",
      alloy_id: "alloy-1",
      temper_id: "temper-1",
      quantity_kg: 250,
      net_rate: 285,
      final_line_value: 71250,
      gross_weight_kg: 250,
      revision_number: 1,
      packing_in_conversion: false,
      include_packing_in_basic: false,
    }];

    const items = buildInvoiceItems(sourceLines, invoiceId, companyId);
    assert.equal(items.length, 1);
    assert.equal(items[0].company_id, companyId);
    assert.equal(items[0].invoice_id, invoiceId);
    assert.equal(items[0].profile_id, "profile-1");
    assert.equal(items[0].section_number, "SEC-001");
    assert.equal(items[0].section_code, "P-100");
    assert.equal(items[0].section_name, "Sliding Track");
    assert.equal(items[0].alloy_id, "alloy-1");
    assert.equal(items[0].temper_id, "temper-1");
    assert.equal(items[0].quantity, 250);
    assert.equal(items[0].unit_rate, 285);
    assert.equal(items[0].line_total, 71250);
    assert.equal(items[0].source_record_id, "disp-1");
    assert.equal(items[0].source_line_id, "packing-1");
  });

  it("propagates from order_items when dispatch not available", () => {
    const sourceLines = [{
      id: "oi-1",
      order_id: "ord-1",
      profile_id: "profile-2",
      section_number: "SEC-002",
      quantity_kg: 100,
      net_rate: 300,
      final_line_value: 30000,
      revision_number: 1,
      packing_in_conversion: false,
      include_packing_in_basic: false,
    }];

    const items = buildInvoiceItems(sourceLines, invoiceId, companyId);
    assert.equal(items.length, 1);
    assert.equal(items[0].source_record_id, "ord-1");
    assert.equal(items[0].source_line_id, "oi-1");
    assert.equal(items[0].section_number, "SEC-002");
    assert.equal(items[0].line_total, 30000);
  });

  it("calculates line_total from weight × rate when final_line_value absent", () => {
    const sourceLines = [{
      id: "oi-2",
      order_id: "ord-2",
      profile_id: "profile-3",
      quantity_kg: 50,
      net_rate: 200,
      revision_number: 1,
      packing_in_conversion: false,
      include_packing_in_basic: false,
    }];

    const items = buildInvoiceItems(sourceLines, invoiceId, companyId);
    assert.equal(items[0].quantity, 50);
    assert.equal(items[0].unit_rate, 200);
    assert.equal(items[0].line_total, 10000);
  });

  it("handles multiple source lines", () => {
    const sourceLines = [
      { id: "a", profile_id: "p1", quantity_kg: 100, net_rate: 200, revision_number: 1, packing_in_conversion: false, include_packing_in_basic: false },
      { id: "b", profile_id: "p2", quantity_kg: 200, net_rate: 150, revision_number: 1, packing_in_conversion: false, include_packing_in_basic: false },
    ];

    const items = buildInvoiceItems(sourceLines, invoiceId, companyId);
    assert.equal(items.length, 2);
    assert.equal(items[0].profile_id, "p1");
    assert.equal(items[1].profile_id, "p2");
    assert.equal(items[0].line_total, 20000);
    assert.equal(items[1].line_total, 30000);
  });

  it("returns empty array for no source lines", () => {
    const items = buildInvoiceItems([], invoiceId, companyId);
    assert.equal(items.length, 0);
  });
});
