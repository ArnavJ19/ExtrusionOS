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
  assert.equal(hasRouteAccess("/analytics", "dealer_admin"), false);
  assert.equal(hasRouteAccess("/settings", "dealer_staff"), false);
});

