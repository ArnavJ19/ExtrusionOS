import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const detail = readFileSync("app/(dashboard)/dispatches/[id]/page.tsx", "utf8");
const migration = readFileSync("supabase/migrations/20260721091307_physical_dispatch_stock_provenance.sql", "utf8");
const dispatchAction = readFileSync("lib/actions/dispatches.ts", "utf8");
const moduleConfig = readFileSync("components/modules/operations/module-config.ts", "utf8");

describe("reservation consumption safety", () => {
  it("does not expose a second non-atomic consumption write path", () => {
    // The former lib/actions/stock-reservations.ts stub (a redirect-only no-op) was
    // removed as dead/misleading code. Reservation consumption must remain solely in
    // the atomic private.consume_dispatch_reservations RPC. Guard that the stub file
    // does not come back as an alternative (non-atomic) write path.
    assert.equal(existsSync("lib/actions/stock-reservations.ts"), false);
  });

  it("explains automatic source-linked consumption instead of presenting a manual button", () => {
    assert.doesNotMatch(detail, />Consume Reserved Stock</);
    assert.match(detail, /posted automatically with the dispatch/);
  });

  it("passes exact reservation and stock-batch provenance into packing rows", () => {
    assert.match(dispatchAction, /profile_stock_batch_id/);
    assert.match(dispatchAction, /profile_stock_consumptions\(consumed_weight_kg\)/);
    assert.match(dispatchAction, /source_kind:\s*"reservation"/);
  });

  it("captures a measured tare for every physical bundle while deriving stock identity", () => {
    assert.match(moduleConfig, /bundle_tare_weights_kg/);
    assert.match(moduleConfig, /Bundle tare kg \(one per line\)/);
    assert.match(dispatchAction, /Enter exactly \$\{numberOfBundles\} bundle tare weights/);
    assert.match(dispatchAction, /profile_stock_batch_id/);
    assert.match(dispatchAction, /reservation_id/);
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
