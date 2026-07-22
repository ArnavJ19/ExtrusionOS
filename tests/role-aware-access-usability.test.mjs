import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  canAccessMobileDestination,
  getDashboardExperience,
  getMobileDestinationKeys,
  getSearchResourceKeys,
} from "../lib/auth/role-experience.ts";
import { hasRouteAccess } from "../lib/auth/route-permissions.ts";

const proxy = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
const auth = readFileSync(new URL("../lib/auth.ts", import.meta.url), "utf8");
const suspendedPage = readFileSync(new URL("../app/(auth)/access-suspended/page.tsx", import.meta.url), "utf8");
const dashboardPage = readFileSync(new URL("../app/(dashboard)/dashboard/page.tsx", import.meta.url), "utf8");
const dashboardClient = readFileSync(new URL("../components/modules/dashboard-client.tsx", import.meta.url), "utf8");
const searchPage = readFileSync(new URL("../app/(dashboard)/search/page.tsx", import.meta.url), "utf8");
const mobileHome = readFileSync(new URL("../app/(dashboard)/mobile/page.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("../components/layout/app-shell.tsx", import.meta.url), "utf8");

test("inactive users have a stable suspended destination and remain blocked from protected pages", () => {
  assert.match(proxy, /appUser && !appUser\.is_active[\s\S]*url\.pathname = "\/access-suspended"/);
  assert.match(auth, /appUser && !appUser\.is_active[\s\S]*redirect\("\/access-suspended"\)/);
  assert.doesNotMatch(auth, /eq\("is_active", true\)/);
  assert.match(suspendedPage, /Your access is suspended/);
  assert.match(suspendedPage, /<LogoutButton \/>/);
});

test("dashboard defaults operational roles to non-commercial operations views", () => {
  for (const role of ["production_manager", "production", "factory_manager", "dispatch_manager", "dispatch", "inventory_manager", "quality", "viewer"]) {
    const experience = getDashboardExperience(role);
    assert.deepEqual(experience.allowedViews, ["operations"]);
    assert.equal(experience.initialView, "operations");
    assert.equal(experience.canSeeCommercial, false);
  }

  assert.equal(getDashboardExperience("owner").initialView, "owner");
  assert.equal(getDashboardExperience("sales").initialView, "sales");
  assert.match(dashboardPage, /commercial \? supabase\.from\("quotes"\)/);
  assert.match(dashboardPage, /getBusinessDateBoundaries\(now\)/);
  assert.match(dashboardPage, /operationalResources=\{experience\.operationalResources\}/);
  assert.match(dashboardClient, /activeTab === "operations"/);
});

test("search resources are derived from read permissions and results open exact records", () => {
  assert.deepEqual(getSearchResourceKeys("dispatch"), ["orders", "dispatches"]);
  assert.deepEqual(getSearchResourceKeys("quality"), ["orders"]);
  assert.deepEqual(getSearchResourceKeys("inventory_manager"), ["profiles", "orders", "dispatches"]);
  assert.equal(getSearchResourceKeys("production").includes("quotes"), false);
  assert.equal(getSearchResourceKeys("sales").includes("quality"), false);

  assert.match(searchPage, /allowedResources\.map/);
  assert.match(searchPage, /href=\{`\/profiles\/\$\{item\.id\}`\}/);
  assert.match(searchPage, /href=\{`\/dies\/\$\{item\.id\}`\}/);
  assert.match(searchPage, /href=\{`\/dispatches\/\$\{item\.id\}`\}/);
});

test("mobile shortcuts and direct subpages share the same module permissions", () => {
  assert.equal(canAccessMobileDestination("dispatch", "dispatch"), true);
  assert.equal(canAccessMobileDestination("dispatch", "jobs"), false);
  assert.equal(canAccessMobileDestination("production", "jobs"), true);
  assert.equal(canAccessMobileDestination("production", "quality"), false);
  assert.equal(canAccessMobileDestination("inventory_manager", "dispatch"), true);
  assert.equal(getMobileDestinationKeys("factory_manager").includes("jobs"), true);

  assert.equal(hasRouteAccess("/mobile/jobs", "dispatch"), false);
  assert.equal(hasRouteAccess("/mobile/dispatch", "dispatch"), true);
  assert.equal(hasRouteAccess("/mobile/quality", "production"), false);
  assert.equal(hasRouteAccess("/mobile", "inventory_manager"), true);
  assert.match(mobileHome, /visibleLinks = links\.filter/);
  assert.match(mobileHome, /allowedDestinations\.filter/);
});

test("factory and inventory managers can discover their permitted operational modules", () => {
  assert.match(shell, /href: "\/dashboard"[\s\S]*"factory_manager"[\s\S]*"inventory_manager"/);
  assert.match(shell, /href: "\/production"[\s\S]*"factory_manager"/);
  assert.match(shell, /href: "\/inventory"[\s\S]*"inventory_manager"/);
  assert.match(shell, /href: "\/dispatches"[\s\S]*"factory_manager"[\s\S]*"inventory_manager"/);
  assert.match(shell, /href: "\/mobile"[\s\S]*"factory_manager"[\s\S]*"inventory_manager"/);
  assert.match(shell, /href: "\/scan"[\s\S]*"factory_manager"[\s\S]*"inventory_manager"/);
  assert.match(shell, /href: "\/invoices", label: "Invoices"[\s\S]*"accounts"[\s\S]*"viewer"/);
});
