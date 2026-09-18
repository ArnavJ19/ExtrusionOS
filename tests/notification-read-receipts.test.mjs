import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20260723090000_notification_read_receipts.sql", import.meta.url), "utf8");
const action = readFileSync(new URL("../lib/actions/notifications.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/(dashboard)/notifications/page.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("../components/modules/notifications-client.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("../components/layout/app-shell.tsx", import.meta.url), "utf8");

test("broadcast notification reads are stored per user behind a tenant-safe RPC", () => {
  assert.match(migration, /create table if not exists public\.notification_read_receipts/);
  assert.match(migration, /primary key \(notification_id, user_id\)/);
  assert.match(migration, /alter table public\.notification_read_receipts enable row level security/);
  assert.match(migration, /recipient_user_id is null/);
  assert.match(migration, /recipient_user_id = auth\.uid\(\)/);
  assert.match(migration, /user_id = auth\.uid\(\)[\s\S]*company_id = private\.get_current_user_company_id\(\)/);
  assert.match(migration, /create or replace function public\.mark_notification_read/);
  assert.match(migration, /security definer[\s\S]*set search_path = public, private/);
  assert.match(migration, /recipient_user_id is null or recipient_user_id = v_user_id/);
  assert.match(migration, /insert into public\.notification_read_receipts/);
  assert.match(migration, /update public\.notifications[\s\S]*recipient_user_id = v_user_id/);
  assert.match(migration, /grant execute on function public\.mark_notification_read\(uuid\) to authenticated/);
});

test("unread badge count excludes broadcasts already read by the current user", () => {
  assert.match(migration, /create or replace function public\.get_unread_notification_count/);
  assert.match(migration, /notification\.recipient_user_id = v_user_id and notification\.is_read = false/);
  assert.match(migration, /notification\.recipient_user_id is null[\s\S]*not exists/);
  assert.match(migration, /receipt\.user_id = v_user_id/);
  assert.match(shell, /rpc\("get_unread_notification_count"\)/);
  assert.doesNotMatch(shell, /from\("notifications"\).*eq\("is_read", false\)/);
});

test("notification page and read action use receipt-aware state end to end", () => {
  assert.match(action, /z\.string\(\)\.uuid/);
  assert.match(action, /await getSessionContext\(\)/);
  assert.match(action, /rpc\("mark_notification_read"/);
  assert.match(action, /revalidatePath\("\/", "layout"\)/);
  assert.match(page, /notification_read_receipts\(user_id, read_at\)/);
  assert.match(page, /receipt\.user_id === context\.userId/);
  assert.match(page, /<NotificationsClient notifications=\{inbox\}/);
  assert.match(client, /markNotificationReadAction\(notificationId\)/);
  assert.match(client, /Mark as read/);
  assert.match(client, /router\.refresh\(\)/);
});
