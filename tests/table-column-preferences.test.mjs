import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("tsx/cjs");
const Module = require("node:module");
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === "@/lib/auth/permissions") return { can: (role, _action, resource) => resource !== "financials" || ["owner", "admin", "accounts"].includes(role) };
  return originalLoad(request, parent, isMain);
};
const { canReadPreferredColumn, getRoleColumnOrder, moveColumn, resolveColumnLayout } = require("../lib/preferences/table-columns.ts");
Module._load = originalLoad;

const columns = [
  { id: "dispatch_number", header: "Dispatch" }, { id: "order", header: "Order" },
  { id: "delivery_status", header: "Status" }, { id: "vehicle_number", header: "Vehicle" },
  { id: "total_weight_kg", header: "Weight" }
];

test("accounts and dispatch roles receive different useful table defaults", () => {
  const accounts = getRoleColumnOrder("dispatches", "accounts", columns);
  const dispatch = getRoleColumnOrder("dispatches", "dispatch", columns);
  assert.deepEqual(accounts.slice(0, 3), ["dispatch_number", "order", "delivery_status"]);
  assert.deepEqual(dispatch, ["dispatch_number", "order", "delivery_status", "vehicle_number", "total_weight_kg"]);
  assert.notDeepEqual(accounts, dispatch);
});

test("identifier remains visible and pinned first after custom hide and reorder preferences", () => {
  const resolved = resolveColumnLayout("dispatches", "dispatch", columns, {
    order: ["total_weight_kg", "vehicle_number", "dispatch_number"],
    hidden: ["dispatch_number", "delivery_status"],
    widths: { total_weight_kg: 210 }
  });
  assert.equal(resolved.identifier, "dispatch_number");
  assert.equal(resolved.columns[0].id, "dispatch_number");
  assert.equal(resolved.columns.some((column) => column.id === "delivery_status"), false);
  assert.equal(resolved.permittedColumns.some((column) => column.id === "delivery_status"), true);
  assert.equal(resolved.widths.total_weight_kg, 210);
});

test("restricted financial columns are excluded by role independently of saved visibility", () => {
  assert.equal(canReadPreferredColumn("quotes", "grand_total", "viewer"), false);
  assert.equal(canReadPreferredColumn("invoices", "balance_due", "dispatch"), false);
  assert.equal(canReadPreferredColumn("expenses", "total_amount", "accounts"), true);
  assert.equal(canReadPreferredColumn("orders", "order_value", "production"), false);
  const orders = resolveColumnLayout("orders", "production", [{ id: "order_number", header: "Order" }, { id: "order_value", header: "Value" }], { order: [], hidden: [], widths: {} });
  assert.deepEqual(orders.columns.map((column) => column.id), ["order_number"]);
});

test("identifier cannot be reordered away from the first visible position", () => {
  const next = moveColumn(columns, "order", -1, "dispatch_number");
  assert.deepEqual(next.map((column) => column.id), columns.map((column) => column.id));
});
