import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const migration = read("supabase/migrations/20260721091620_quote_atomic_dealer_lineage.sql");
const quoteActions = read("lib/actions/quotes-orders.ts");
const quoteOrderForm = read("components/modules/orders/quote-order-form-client.tsx");
const productionForm = read("components/modules/operations/record-form-client.tsx");

test("quote header, snapshot, and items save inside one guarded transaction", () => {
  assert.match(quoteActions, /rpc\("save_quote_atomic"/);
  assert.match(quoteActions, /p_expected_revision:/);
  assert.match(quoteActions, /p_expected_updated_at:/);
  assert.doesNotMatch(quoteActions, /from\("quote_revisions"\)\.insert/);
  assert.match(migration, /create or replace function private\.save_quote_atomic/);
  assert.match(migration, /from public\.quotes[\s\S]*for update/);
  assert.match(migration, /insert into public\.quote_revisions[\s\S]*delete from public\.quote_items[\s\S]*private\.insert_jsonb_row/);
  assert.match(migration, /p_expected_updated_at is distinct from v_current\.updated_at/);
  assert.match(migration, /language sql[\s\S]*security invoker[\s\S]*select private\.save_quote_atomic/);
  assert.match(migration, /grant execute on function private\.save_quote_atomic[\s\S]*to authenticated/);
});

test("dealer stock is allocated by exact quote line and finish", () => {
  for (const column of ["quote_item_id", "order_item_id", "finishing_type", "unit_rate"]) {
    assert.match(migration, new RegExp(`add column if not exists ${column}`));
  }
  assert.match(migration, /quote_item_id', v_line\.id/);
  assert.match(migration, /batch\.profile_id = v_line\.profile_id/);
  assert.match(migration, /regexp_replace\(batch\.finish[\s\S]*regexp_replace\(v_line\.finishing_type/);
  assert.match(migration, /Dealer-stock packing requires exact quote, order, finish, and rate lineage/);
  assert.match(migration, /new\.quote_item_id := v_quote_item_id/);
  assert.match(migration, /new\.net_rate := v_rate/);
  assert.match(migration, /if new\.source_kind = 'reservation'/);
  assert.match(migration, /Reserved-stock packing source does not match its order, profile, reservation, and stock batch/);
});

test("availability and production planning respect finish and per-line factory balance", () => {
  assert.match(quoteOrderForm, /quote_items\(id, profile_id, finishing_type/);
  assert.match(quoteOrderForm, /profile_stock_batch_id, reserved_weight_kg/);
  assert.match(quoteOrderForm, /demandByProfileFinish/);
  assert.match(quoteOrderForm, /stockByProfileFinish/);
  assert.match(productionForm, /item\.manufacturing_weight_kg \?\? item\.billing_weight_kg/);
});
