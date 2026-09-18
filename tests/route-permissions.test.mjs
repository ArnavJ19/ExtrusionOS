import test from "node:test";
import assert from "node:assert/strict";
import { hasRouteAccess, isProtectedPath } from "../lib/auth/route-permissions.ts";

test("analytics route is protected and restricted by role", () => {
  assert.equal(isProtectedPath("/analytics"), true);
  assert.equal(hasRouteAccess("/analytics", "owner"), true);
  assert.equal(hasRouteAccess("/analytics", "admin"), true);
  assert.equal(hasRouteAccess("/analytics", "sales_manager"), true);
  assert.equal(hasRouteAccess("/analytics", "accounts"), true);
  assert.equal(hasRouteAccess("/analytics", "sales"), false);
  assert.equal(hasRouteAccess("/analytics", "production_manager"), false);
  assert.equal(hasRouteAccess("/analytics", "dealer_admin"), false);
});

test("dealer users remain restricted to dealer-safe prefixes", () => {
  assert.equal(hasRouteAccess("/dealer-orders", "dealer_admin"), true);
  assert.equal(hasRouteAccess("/dealer-orders/new", "dealer_staff"), true);
  assert.equal(hasRouteAccess("/dealer-inventory", "dealer_admin"), true);
  assert.equal(hasRouteAccess("/dealer-inventory", "dealer_staff"), true);
  assert.equal(hasRouteAccess("/quotes", "dealer_admin"), false);
  assert.equal(hasRouteAccess("/quotes/quote-42/edit", "dealer_staff"), false);
  assert.equal(hasRouteAccess("/analytics", "dealer_admin"), false);
  assert.equal(hasRouteAccess("/settings", "dealer_staff"), false);
});

test("internal quote and sensitive module routes fail closed by role", () => {
  for (const role of ["owner", "admin", "sales_manager", "sales", "accounts", "viewer"]) {
    assert.equal(hasRouteAccess("/quotes/quote-42", role), true, `${role} should retain internal quote access`);
  }

  assert.equal(hasRouteAccess("/invoices", "production"), false);
  assert.equal(hasRouteAccess("/documents", "accounts"), false);
  assert.equal(hasRouteAccess("/quality/inspection-1", "dispatch"), false);
  assert.equal(hasRouteAccess("/settings/enterprise", "admin"), true);
  assert.equal(hasRouteAccess("/settings/access", "admin"), false);
  assert.equal(hasRouteAccess("/portal/orders", "sales"), false);
});
