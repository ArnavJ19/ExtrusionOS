import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const action = readFileSync("lib/actions/stock-reservations.ts", "utf8");
const detail = readFileSync("app/(dashboard)/dispatches/[id]/page.tsx", "utf8");
const migration = readFileSync("supabase/migrations/20260721091307_physical_dispatch_stock_provenance.sql", "utf8");
const exactManifestMigration = readFileSync("supabase/migrations/20260723060000_exact_dispatch_manifest_and_consolidation.sql", "utf8");
const dispatchAction = readFileSync("lib/actions/dispatches.ts", "utf8");
const dispatchForm = readFileSync("components/modules/dispatch-form-client.tsx", "utf8");

describe("reservation consumption safety", () => {
  it("does not expose a second non-atomic consumption write path", () => {
    assert.doesNotMatch(action, /profile_stock_consumptions"\)\.insert/);
    assert.match(action, /redirect\(`\/dispatches\/\$\{dispatchId\}`\)/);
  });

  it("explains automatic source-linked consumption instead of presenting a manual button", () => {
    assert.doesNotMatch(detail, />Consume Reserved Stock</);
    assert.match(detail, /posted automatically with the dispatch/);
  });

  it("passes exact reservation and stock-batch provenance into packing rows", () => {
    assert.match(dispatchAction, /profile_stock_batch_id/);
    assert.match(dispatchAction, /loadReservationConsumptionTotals/);
    assert.match(dispatchAction, /source_kind:\s*"reservation"/);
  });

  it("requires the operator to scan and identify every physical bundle and source", () => {
    assert.match(dispatchForm, /Scan \/ Bundle ID/);
    assert.match(dispatchForm, /Exact material source/);
    assert.match(dispatchForm, /Actual pieces/);
    assert.match(dispatchForm, /Gross kg/);
    assert.match(dispatchForm, /Tare kg/);
    assert.match(dispatchAction, /buildVerifiedPackingListItems/);
    assert.match(dispatchAction, /profile_stock_batch_id/);
    assert.match(dispatchAction, /reservation_id/);
    assert.match(exactManifestMigration, /operator_verified_at/);
    assert.match(exactManifestMigration, /Scan or enter every physical bundle identifier/);
  });

  it("consumes reservations and decrements completed reservation stock in one transaction", () => {
    assert.match(migration, /function private\.consume_dispatch_reservations/);
    assert.match(migration, /perform private\.consume_dispatch_reservations\(v_dispatch_id\)/);
    assert.match(migration, /set total_weight_kg = v_new_weight/);
    assert.match(migration, /set status = 'consumed', released_at = now\(\)/);
    assert.match(migration, /on conflict \(company_id, dispatch_id, reservation_id\)/);
    assert.doesNotMatch(migration, /create policy[^;]+profile_stock_consumptions[^;]+for insert/is);
  });
});
