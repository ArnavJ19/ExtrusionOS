import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { buildVerifiedPackingListItems } from "../lib/pcda/dispatch.ts";

const read = (path) => readFileSync(path, "utf8");

describe("dispatch integrity hardening", () => {
  it("rejects fractional physical piece counts instead of rounding them", () => {
    assert.throws(() => buildVerifiedPackingListItems([{
      id: "job-1",
      order_id: "order-1",
      profile_id: "profile-1",
      available_weight_kg: 20,
      actual_quantity_kg: 20,
      actual_pieces: 10
    }], "company-1", [{
      bundle_number: "B-001",
      source_line_id: "job-1",
      number_of_pieces: 2.6,
      gross_weight_kg: 11,
      tare_weight_kg: 1
    }]), /actual positive piece count/);
  });

  it("requires a dispatch-scoped durable POD and blocks terminal reactivation", () => {
    const action = read("lib/actions/dispatches.ts");
    const workflow = read("components/modules/dispatch-delivery-workflow.tsx");
    const migration = read("supabase/migrations/20260812010000_dispatch_return_and_manifest_integrity.sql");

    assert.match(action, /proofPath && !proofPath\.startsWith\(expectedProofPrefix\)/);
    assert.doesNotMatch(action, /isExternalProof/);
    assert.match(workflow, /damaged: \["returned"\]/);
    assert.match(workflow, /returned: \[\]/);
    assert.doesNotMatch(workflow, /paste an existing signed POD link/i);
    assert.match(migration, /document\.storage_path = btrim\(new\.proof_of_delivery_url\)/);
    assert.match(migration, /document\.linked_entity_id = new\.id/);
    assert.doesNotMatch(migration, /p_from = 'returned' and p_to = 'dispatched'/);
    assert.doesNotMatch(migration, /p_from = 'damaged' and p_to in \('dispatched'/);
  });

  it("accepts only byte-for-byte equivalent normalized dealer receipt retries", () => {
    const migration = read("supabase/migrations/20260812010000_dispatch_return_and_manifest_integrity.sql");

    assert.match(migration, /add column if not exists request_payload jsonb/);
    assert.match(migration, /v_existing\.request_payload <> v_request_payload/);
    assert.match(migration, /Receipt retry payload differs from the recorded receipt/);
    assert.match(migration, /order by coalesce\(line->>'shipment_item_id', line->>'shipmentItemId'\)/);
    assert.match(migration, /set request_payload = v_request_payload/);
  });
});
