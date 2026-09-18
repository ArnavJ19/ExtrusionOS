import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const dispatchMigration = readFileSync("supabase/migrations/20260723060000_exact_dispatch_manifest_and_consolidation.sql", "utf8");
const minimumQueueMigration = readFileSync("supabase/migrations/20260723055000_canonical_factory_minimum_queue.sql", "utf8");
const creditMigration = readFileSync("supabase/migrations/20260723070000_dispatch_return_credit_notes.sql", "utf8");
const dispatchAction = readFileSync("lib/actions/dispatches.ts", "utf8");
const dispatchForm = readFileSync("components/modules/dispatch-form-client.tsx", "utf8");
const consolidationAction = readFileSync("lib/actions/factory-loads.ts", "utf8");
const consolidationPage = readFileSync("app/(dashboard)/production/consolidation/page.tsx", "utf8");
const creditAction = readFileSync("lib/actions/credit-notes.ts", "utf8");
const creditPanel = readFileSync("components/modules/dispatch-credit-note-client.tsx", "utf8");

describe("factory practicality closure", () => {
  it("posts only operator-verified exact physical manifests", () => {
    assert.match(dispatchAction, /buildVerifiedPackingListItems/);
    assert.match(dispatchAction, /save_ready_dispatch_atomic/);
    assert.match(dispatchForm, /one tagged physical bundle loaded on the vehicle/i);
    assert.match(dispatchMigration, /validate_operator_dispatch_bundle/);
    assert.match(dispatchMigration, /operator_verified_by/);
    assert.match(dispatchMigration, /'bundle_number', v_bundle_number/);
    assert.doesNotMatch(dispatchMigration, /v_bundle_number\s*:=\s*private\.next_business_number_locked/);
  });

  it("holds sub-minimum orders until consolidation or an authorized override", () => {
    assert.doesNotMatch(minimumQueueMigration, /below the 700 kg manufacturing minimum/);
    assert.match(minimumQueueMigration, /revoke all on function public\.create_order_from_quote_with_dealer_stock[^;]+authenticated/);
    assert.match(dispatchMigration, /factory_load_consolidations/);
    assert.match(dispatchMigration, /v_manufacturing_weight > 0 and v_manufacturing_weight < 700/);
    assert.match(dispatchMigration, /Only an owner or factory\/production manager can override/);
    assert.match(dispatchMigration, /guard_pending_factory_load/);
    assert.match(dispatchMigration, /factory_load_consolidated/);
    assert.match(dispatchMigration, /compatibility_signature/);
    assert.match(dispatchMigration, /incompatible alloy, temper, or billet-diameter requirements/);
    assert.match(consolidationAction, /release_factory_loads_atomic/);
    assert.match(consolidationPage, /Combine sub-700 kg manufacturing orders/);
  });

  it("preserves the issued invoice while recording and reversing a credit note atomically", () => {
    assert.match(creditMigration, /create table if not exists public\.credit_notes/);
    assert.match(creditMigration, /issue_dispatch_return_credit_note_atomic/);
    assert.match(creditMigration, /reverse_credit_note_atomic/);
    assert.match(creditMigration, /customer_credit_due/);
    assert.match(creditMigration, /dispatch_credit_note_issued/);
    assert.match(creditAction, /idempotency_key/);
    assert.match(creditPanel, /original invoice remains intact/i);
  });
});
