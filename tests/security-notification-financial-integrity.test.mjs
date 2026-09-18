import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const migration = readFileSync(
  join(root, "supabase", "migrations", "20260812000000_security_and_notification_integrity.sql"),
  "utf8"
);
const quoteAtomic = readFileSync(
  join(root, "supabase", "migrations", "20260721091620_quote_atomic_dealer_lineage.sql"),
  "utf8"
);

test("migration is transactional and has balanced function bodies", () => {
  assert.match(migration.trimStart(), /^begin;/i);
  assert.match(migration.trimEnd(), /commit;$/i);
  assert.equal((migration.match(/\$\$/g) ?? []).length % 2, 0);
});

test("self profile updates cannot mutate server-owned access fields", () => {
  assert.match(migration, /guard_self_app_user_security_fields/);
  assert.match(migration, /auth\.uid\(\) = old\.id/);
  for (const field of [
    "id",
    "company_id",
    "role",
    "dealer_id",
    "branch_id",
    "is_active",
    "status",
    "organization_type"
  ]) {
    assert.match(migration, new RegExp(`new\\.${field} is distinct from old\\.${field}`));
  }
  assert.match(migration, /before update on public\.app_users/);
  assert.match(migration, /errcode = '42501'/);
});

test("notification select, mark-read, and unread count share one role and dealer audience predicate", () => {
  assert.match(migration, /notification_visible_to_current_user/);
  assert.match(migration, /p_recipient_user_id = auth\.uid\(\)/);
  assert.match(migration, /p_recipient_role is null or p_recipient_role = private\.get_current_user_role\(\)/);
  assert.match(migration, /p_dealer_id = private\.get_current_user_dealer_id\(\)/);
  assert.match(migration, /create policy "notifications tenant read"[\s\S]*notification_visible_to_current_user/);
  assert.match(migration, /create or replace function public\.mark_notification_read[\s\S]*notification\.recipient_role[\s\S]*notification\.dealer_id/);
  assert.match(migration, /create or replace function public\.get_unread_notification_count[\s\S]*notification\.recipient_role[\s\S]*notification\.dealer_id/);
  assert.match(migration, /insert into public\.notification_read_receipts/);
});

test("billet lineage uses typed rows and does not dereference an unassigned generic requirement record", () => {
  assert.match(migration, /v_requirement public\.order_billet_requirements%rowtype/);
  assert.match(migration, /v_job public\.production_jobs%rowtype/);
  assert.doesNotMatch(migration, /v_requirement record/);
  assert.match(migration, /if new\.allocation_requirement_id is not null[\s\S]*select \*[\s\S]*into v_requirement/);
  assert.match(migration, /if new\.allocation_requirement_id is not null[\s\S]*v_requirement\.profile_id <> v_job\.profile_id/);
});

test("quote headers are derived from quote items after every item mutation", () => {
  assert.match(migration, /create or replace function private\.derive_quote_header_financials/);
  assert.match(migration, /sum\(item\.line_total_before_gst\)/);
  assert.match(migration, /sum\(item\.estimated_profit_amount\)/);
  assert.match(migration, /new\.grand_total := v_subtotal \+ v_gst_amount/);
  assert.match(migration, /before insert or update on public\.quotes/);
  assert.match(migration, /after insert or update or delete on public\.quote_items/);
  assert.match(migration, /update public\.quotes[\s\S]*set updated_at = now\(\)/);
});

test("quote header derivation preserves the atomic quote save formula and public RPC", () => {
  assert.match(quoteAtomic, /create or replace function public\.save_quote_atomic/);
  assert.match(quoteAtomic, /select private\.save_quote_atomic/);
  assert.match(quoteAtomic, /sum\(item\.line_total_before_gst\)/);
  assert.match(quoteAtomic, /sum\(item\.estimated_profit_amount\)/);
  assert.match(quoteAtomic, /grand_total = v_subtotal \+ v_gst_amount/);
  assert.match(migration, /estimated_profit_percent := case[\s\S]*v_profit \/ v_subtotal \* 100/);
});
