import test from "node:test";
import assert from "node:assert/strict";
import { buildTaskNavigation } from "../lib/navigation/task-navigation.ts";
import { hasRouteAccess } from "../lib/auth/route-permissions.ts";
import { defaultFeatureFlags, isFeatureEnabled } from "../lib/enterprise/features.ts";

const roles = [
  "owner", "admin", "sales_manager", "sales", "production_manager", "production",
  "dispatch_manager", "dispatch", "accounts", "quality", "viewer", "factory_manager",
  "inventory_manager", "dealer_admin", "dealer_staff"
];

const routes = [
  ["/dashboard", "Dashboard", ["owner", "admin", "sales_manager", "sales", "production_manager", "production", "dispatch_manager", "dispatch", "accounts", "quality", "viewer", "factory_manager", "inventory_manager", "dealer_admin", "dealer_staff"]],
  ["/tasks", "Tasks", roles],
  ["/orders", "Orders", ["owner", "admin", "sales_manager", "sales", "production_manager", "production", "dispatch_manager", "dispatch", "accounts", "quality", "viewer", "factory_manager", "inventory_manager"]],
  ["/foundry", "Foundry", ["owner", "admin", "production_manager", "production", "factory_manager", "viewer"]],
  ["/production", "Production", ["owner", "admin", "production_manager", "production", "factory_manager", "viewer"], "production_planning"],
  ["/dispatches", "Dispatches", ["owner", "admin", "sales_manager", "sales", "factory_manager", "dispatch_manager", "dispatch", "inventory_manager", "accounts", "viewer"]],
  ["/customers", "Customers", ["owner", "admin", "sales_manager", "sales", "production_manager", "factory_manager", "dispatch_manager", "accounts", "viewer"]],
  ["/profiles", "Profiles", ["owner", "admin", "sales_manager", "sales", "production_manager", "production", "factory_manager", "inventory_manager", "quality", "viewer"]],
  ["/quality", "Quality", ["owner", "admin", "production_manager", "quality", "viewer"], "quality_compliance"],
  ["/discrepancies", "Discrepancies", ["owner", "admin", "factory_manager", "inventory_manager", "dealer_admin", "dealer_staff"]],
  ["/quotes", "Quotes", ["owner", "admin", "sales_manager", "sales", "accounts", "viewer"]],
  ["/inventory", "Inventory", ["owner", "admin", "production_manager", "production", "dispatch_manager", "dispatch", "viewer", "factory_manager", "inventory_manager", "dealer_admin", "dealer_staff"]],
  ["/dealer-orders", "Dealer Orders", ["owner", "admin", "sales_manager", "sales", "factory_manager", "inventory_manager", "dealer_admin", "dealer_staff"]],
  ["/dealer-inventory", "Dealer Ledger", ["owner", "admin", "sales_manager", "factory_manager", "inventory_manager", "viewer", "dealer_admin", "dealer_staff"], "dealer_portal"],
  ["/invoices", "Invoices", ["owner", "admin", "accounts", "viewer"]],
  ["/reports", "Reports", ["owner", "admin", "sales_manager", "accounts"], "report_builder"],
  ["/settings/access", "Users & Roles", ["owner"]]
].map(([href, label, allowedRoles, module]) => ({ href, label, icon: "FileText", roles: allowedRoles, ...(module ? { module } : {}) }));

function navigation(role, items = routes, primaryLimit = 4) {
  return buildTaskNavigation({
    items,
    role,
    featureFlags: defaultFeatureFlags,
    hasRouteAccess: () => true,
    isFeatureEnabled,
    primaryLimit
  });
}

test("all 15 roles receive a short primary set and grouped additional destinations", () => {
  for (const role of roles) {
    const model = navigation(role);
    assert.ok(model.primary.length > 0, `${role} should have primary navigation`);
    assert.ok(model.primary.length <= 4, `${role} should keep mobile navigation short`);
    assert.ok(model.more.length > 0, `${role} should have a More destination`);
    assert.ok(model.more.every((group) => group.label && group.items.length), `${role} More destinations should be grouped`);
  }
});

test("role allowlists remain intact and company-disabled modules are omitted", () => {
  const model = buildTaskNavigation({
    items: routes,
    role: "sales",
    featureFlags: { ...defaultFeatureFlags, dealer_portal: false },
    hasRouteAccess: () => true,
    isFeatureEnabled
  });
  const all = [...model.primary, ...model.more.flatMap((group) => group.items)];
  assert.ok(all.some((item) => item.href === "/quotes"));
  assert.ok(!all.some((item) => item.href === "/dealer-inventory"));
  const owner = navigation("owner");
  assert.ok([...owner.primary, ...owner.more.flatMap((group) => group.items)].some((item) => item.href === "/settings/access"));
  const sales = navigation("sales");
  assert.ok(![...sales.primary, ...sales.more.flatMap((group) => group.items)].some((item) => item.href === "/settings/access"));
});

test("duplicate routes are removed without losing distinct destinations", () => {
  const duplicates = [...routes, routes[1], { ...routes[1], label: "Duplicate task label" }];
  const model = navigation("owner", duplicates);
  const all = [...model.primary, ...model.more.flatMap((group) => group.items)];
  assert.equal(all.length, new Set(all.map((item) => item.href)).size);
  assert.deepEqual(new Set(all.map((item) => item.href)), new Set(routes.filter((item) => item.roles.includes("owner") && (!item.module || isFeatureEnabled(defaultFeatureFlags, item.module))).map((item) => item.href)));
});

test("route access honors exact path segment boundaries", () => {
  assert.equal(hasRouteAccess("/settings/access", "owner"), true);
  assert.equal(hasRouteAccess("/orders-extra", "owner"), false);
  assert.equal(hasRouteAccess("/settings/access", "admin"), false);
});
