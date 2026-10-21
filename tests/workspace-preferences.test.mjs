import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyWorkspacePreferences,
  getWorkspaceStorage,
  isRouteAllowedByNavigation,
  makeViewState,
  mergeWorkspacePreferenceChanges,
  readWorkspacePreferences,
  sanitizeWorkspacePreferences,
  upsertNamedWorkspaceView,
  viewStateParams,
  workspaceListUrl,
  workspacePreferenceKey,
  writeWorkspacePreferences
} from "../lib/preferences/workspace-preferences.ts";

test("workspace storage key is isolated by both company and user", () => {
  assert.notEqual(workspacePreferenceKey({ companyId: "company-a", userId: "user-a" }), workspacePreferenceKey({ companyId: "company-b", userId: "user-a" }));
  assert.notEqual(workspacePreferenceKey({ companyId: "company-a", userId: "user-a" }), workspacePreferenceKey({ companyId: "company-a", userId: "user-b" }));
});

test("shortcut routes honor enabled navigation bases and reject prefix lookalikes", () => {
  assert.equal(isRouteAllowedByNavigation("/orders/123", ["/orders"]), true);
  assert.equal(isRouteAllowedByNavigation("/orders/database", ["/orders"]), true);
  assert.equal(isRouteAllowedByNavigation("/orders-archive", ["/orders"]), false);
  assert.equal(isRouteAllowedByNavigation("/profitability", ["/orders"]), false);
});

test("blocked and corrupt storage safely returns an empty workspace", () => {
  const blocked = { getItem() { throw new Error("blocked"); } };
  assert.deepEqual(readWorkspacePreferences(blocked, "key"), emptyWorkspacePreferences());
  assert.deepEqual(readWorkspacePreferences({ getItem: () => "{" }, "key"), emptyWorkspacePreferences());
  assert.equal(writeWorkspacePreferences({ setItem() { throw new Error("blocked"); } }, "key", emptyWorkspacePreferences()), false);
});

test("storage accessor catches a throwing localStorage property getter", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: Object.defineProperty({}, "localStorage", { get() { throw new Error("SecurityError"); } }) });
  try {
    assert.equal(getWorkspaceStorage(), null);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else delete globalThis.window;
  }
});

test("a list preference update cannot restore shell shortcuts removed since the list loaded", () => {
  const original = { ...emptyWorkspacePreferences(), pinned: [{ href: "/orders/database", label: "Orders", moduleKey: "orders", updatedAt: 1 }] };
  const latest = { ...original, pinned: [] };
  const listUpdate = { ...original, columns: { orders: { order: ["order_number"], hidden: [], widths: {} } } };
  const merged = mergeWorkspacePreferenceChanges(original, listUpdate, latest);
  assert.deepEqual(merged.pinned, []);
  assert.deepEqual(merged.columns.orders.order, ["order_number"]);
});

test("preference sanitizer bounds entries, rejects unsafe URLs, clamps widths and drops financial payloads", () => {
  const link = (href, index) => ({ href, label: `View ${index}`, moduleKey: "orders", updatedAt: 1 });
  const sanitized = sanitizeWorkspacePreferences({
    pinned: [link("//evil.example", 0), ...Array.from({ length: 40 }, (_, index) => link(`/orders/database?page=${index + 1}`, index))],
    recent: [link("javascript:alert(1)", 1), { ...link("/orders/record-id", 2), recordId: "record-id" }],
    views: [{ ...link("/orders/database?status=confirmed", 1), state: { search: "billet", status: "confirmed", secondary: "", dateFrom: "", dateTo: "", page: 2, sort: "order_date", direction: "desc", relationFilters: { customer_id: "customer-a" }, amount: 50000 } }],
    columns: { orders: { order: ["order_number"], hidden: ["priority"], widths: { order_number: 900 } } },
    internal_cost: 70000
  });
  assert.equal(sanitized.pinned.length, 24);
  assert.equal(sanitized.recent.length, 1);
  assert.equal(sanitized.views[0].state.relationFilters.customer_id, "customer-a");
  assert.equal(sanitized.columns.orders.widths.order_number, 480);
  assert.equal(JSON.stringify(sanitized).includes("internal_cost"), false);
  assert.equal(JSON.stringify(sanitized).includes("amount"), false);
});

test("list URL state round trips search, filters, page, sort, and connected-record scope", () => {
  const state = makeViewState(new URLSearchParams("search=O-104&status=packing&secondary=urgent&dateFrom=2026-10-01&dateTo=2026-10-20&page=4&sort=expected_dispatch_date&direction=desc&customer_id=customer-a"));
  const restored = makeViewState(viewStateParams(state));
  assert.deepEqual(restored, state);
});

test("saving a named view updates its name or URL without duplicate shortcut identities", () => {
  const state = makeViewState(new URLSearchParams("status=packing"));
  const original = { href: "/orders/database?status=packing", label: "Packing", moduleKey: "orders", updatedAt: 1, state };
  const renamed = { ...original, label: "Packing queue", updatedAt: 2 };
  assert.deepEqual(upsertNamedWorkspaceView([original], renamed), [renamed]);
  const changedFilter = { ...renamed, href: "/orders/database?status=dispatched", updatedAt: 3 };
  assert.deepEqual(upsertNamedWorkspaceView([renamed], changedFilter), [changedFilter]);
});

test("rapid list control updates serialize together and browser Back restores the prior list state", () => {
  const previous = "/orders/database?search=ORD-2026-04&status=order_confirmed&secondary=normal&page=1&sort=order_number";
  const state = makeViewState(new URLSearchParams("search=ORD-2026-05&status=order_confirmed&secondary=high&page=2&sort=order_number&direction=asc"));
  const [pathname, query = ""] = previous.split("?");
  const next = workspaceListUrl(pathname, query, state, ["customer_id", "profile_id", "order_id"]);
  const parsed = new URL(next, "https://extrusionos.invalid");
  assert.equal(parsed.searchParams.get("search"), "ORD-2026-05");
  assert.equal(parsed.searchParams.get("status"), "order_confirmed");
  assert.equal(parsed.searchParams.get("secondary"), "high");
  assert.equal(parsed.searchParams.get("page"), "2");
  assert.equal(parsed.searchParams.get("sort"), "order_number");
  assert.equal(makeViewState(new URLSearchParams(new URL(previous, "https://extrusionos.invalid").search)).search, "ORD-2026-04");
});
