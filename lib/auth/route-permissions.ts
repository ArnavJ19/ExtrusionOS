import type { UserRole } from "@/types/app";
import { canAccessMobileApp, canAccessMobileDestination } from "./role-experience.ts";

export const protectedPrefixes = [
  "/ai",
  "/analytics",
  "/automation",
  "/audit-logs",
  "/barcode",
  "/command-center",
  "/communications",
  "/compliance",
  "/crm",
  "/customers",
  "/dashboard",
  "/dealer-inventory",
  "/dealer-orders",
  "/die-intelligence",
  "/dies",
  "/dispatches",
  "/discrepancies",
  "/documents",
  "/energy",
  "/expenses",
  "/exports",
  "/foundry",
  "/inventory",
  "/invoices",
  "/maintenance",
  "/machines",
  "/mobile",
  "/notifications",
  "/orders",
  "/packaging",
  "/payments",
  "/portal",
  "/production",
  "/profiles",
  "/profitability",
  "/quality",
  "/quotes",
  "/report-builder",
  "/reports",
  "/scan",
  "/search",
  "/settings",
  "/shipments",
  "/systems-configurator",
  "/tasks",
  "/tenders",
  "/vendors",
];

type RoleRule = {
  prefix: string;
  roles: UserRole[];
};

const roleRules: RoleRule[] = [
  { prefix: "/dispatches/loads", roles: ["owner", "admin", "factory_manager", "dispatch_manager", "dispatch", "production_manager", "production", "sales_manager", "sales"] },
  { prefix: "/vendors/purchasing", roles: ["owner", "admin", "accounts", "inventory_manager"] },
  { prefix: "/tasks/changes", roles: ["owner", "admin", "sales_manager", "production_manager", "factory_manager", "inventory_manager", "dispatch_manager", "quality", "accounts"] },
  { prefix: "/customers/portal-responses", roles: ["owner", "admin", "sales_manager", "sales"] },
  { prefix: "/production/usage", roles: ["owner", "admin", "production_manager", "production", "factory_manager", "accounts"] },
  { prefix: "/production/cutting/rules", roles: ["owner", "admin", "production_manager", "quality"] },
  // AP-013: the scrap yard (stores) records monthly weighings against derived scrap.
  { prefix: "/production/scrap-standards", roles: ["owner", "admin", "production_manager", "production", "factory_manager", "inventory_manager"] },
  // AP-016: QC records in-process samples; supervisors see sampling compliance on their jobs.
  { prefix: "/quality/samples", roles: ["owner", "admin", "quality", "factory_manager", "production_manager", "production"] },
  { prefix: "/vendors/comparisons", roles: ["owner", "admin", "accounts"] },
  // Autopilot batch 3 (order-to-cash): credit holds, draft jobs, invoice drafts, GST rules, bank matching, reminders.
  { prefix: "/orders/credit", roles: ["owner", "admin", "accounts", "sales_manager", "sales"] },
  { prefix: "/production/drafts", roles: ["owner", "admin", "production_manager", "factory_manager", "sales_manager"] },
  { prefix: "/invoices/drafts", roles: ["owner", "admin", "accounts"] },
  { prefix: "/invoices/tax-rules", roles: ["owner", "admin", "accounts"] },
  { prefix: "/payments/bank", roles: ["owner", "admin", "accounts"] },
  { prefix: "/payments/reminders", roles: ["owner", "admin", "accounts"] },
  { prefix: "/settings/data/duplicates", roles: ["owner", "admin", "accounts", "sales_manager"] },
  // Autopilot batch 4 (dispatch and compliance): loading by scan, gate, labels, ready list, packing, e-way bills, freight, Tally.
  { prefix: "/dispatches/loading", roles: ["owner", "admin", "factory_manager", "dispatch_manager", "dispatch", "inventory_manager"] },
  { prefix: "/dispatches/gate", roles: ["owner", "admin", "factory_manager", "dispatch_manager", "dispatch", "accounts", "inventory_manager"] },
  { prefix: "/dispatches/labels", roles: ["owner", "admin", "factory_manager", "dispatch_manager", "dispatch", "inventory_manager"] },
  { prefix: "/dispatches/ready", roles: ["owner", "admin", "factory_manager", "dispatch_manager", "dispatch", "inventory_manager", "sales_manager", "sales", "accounts", "production_manager"] },
  { prefix: "/dispatches/packing", roles: ["owner", "admin", "factory_manager", "dispatch_manager", "dispatch", "inventory_manager", "sales_manager", "quality", "production_manager"] },
  { prefix: "/dispatches/eway", roles: ["owner", "admin", "accounts", "dispatch_manager", "dispatch"] },
  { prefix: "/dispatches/freight", roles: ["owner", "admin", "dispatch_manager", "dispatch", "factory_manager", "sales_manager", "sales", "accounts"] },
  { prefix: "/invoices/tally", roles: ["owner", "admin", "accounts"] },
  { prefix: "/settings/access", roles: ["owner"] },
  // AP-007: stores, accounts and the plant head load and sign off their own opening sections.
  { prefix: "/settings/data/cutover", roles: ["owner", "admin", "accounts", "inventory_manager", "factory_manager", "production_manager", "sales_manager"] },
  { prefix: "/settings", roles: ["owner", "admin"] },
  { prefix: "/dashboard", roles: ["owner", "admin", "sales_manager", "sales", "production_manager", "production", "factory_manager", "dispatch_manager", "dispatch", "inventory_manager", "accounts", "quality", "viewer", "dealer_admin", "dealer_staff"] },
  { prefix: "/audit-logs", roles: ["owner", "admin", "viewer"] },
  { prefix: "/command-center", roles: ["owner", "admin"] },
  { prefix: "/automation", roles: ["owner", "admin"] },
  { prefix: "/barcode", roles: ["owner", "admin", "production_manager", "dispatch_manager"] },
  { prefix: "/energy", roles: ["owner", "admin", "production_manager"] },
  { prefix: "/maintenance", roles: ["owner", "admin", "production_manager"] },
  { prefix: "/ai", roles: ["owner", "admin", "sales_manager", "sales"] },
  { prefix: "/crm", roles: ["owner", "admin", "sales_manager", "sales"] },
  { prefix: "/communications", roles: ["owner", "admin", "sales_manager", "sales"] },
  { prefix: "/reports", roles: ["owner", "admin", "sales_manager", "accounts"] },
  { prefix: "/analytics", roles: ["owner", "admin", "sales_manager", "accounts"] },
  { prefix: "/report-builder", roles: ["owner", "admin", "sales_manager", "accounts"] },
  { prefix: "/profitability", roles: ["owner", "admin", "accounts"] },
  { prefix: "/compliance", roles: ["owner", "admin", "quality"] },
  { prefix: "/tenders", roles: ["owner", "admin", "sales_manager"] },
  { prefix: "/exports", roles: ["owner", "admin", "sales_manager", "dispatch_manager"] },
  { prefix: "/die-intelligence", roles: ["owner", "admin", "production_manager", "quality"] },
  { prefix: "/expenses", roles: ["owner", "admin", "accounts", "viewer"] },
  { prefix: "/invoices", roles: ["owner", "admin", "accounts", "viewer"] },
  { prefix: "/payments", roles: ["owner", "admin", "accounts", "viewer"] },
  { prefix: "/documents", roles: ["owner", "admin", "sales_manager", "production_manager", "quality"] },
  { prefix: "/customers/projects", roles: ["owner", "admin", "sales_manager", "sales", "production_manager", "factory_manager", "dispatch_manager", "dispatch", "accounts", "viewer"] },
  { prefix: "/customers", roles: ["owner", "admin", "sales_manager", "sales", "production_manager", "factory_manager", "dispatch_manager", "accounts", "viewer"] },
  { prefix: "/profiles", roles: ["owner", "admin", "sales_manager", "sales", "production_manager", "production", "factory_manager", "inventory_manager", "quality", "viewer"] },
  { prefix: "/dies", roles: ["owner", "admin", "sales_manager", "sales", "production_manager", "production", "quality", "viewer"] },
  { prefix: "/quotes", roles: ["owner", "admin", "sales_manager", "sales", "accounts", "viewer"] },
  { prefix: "/systems-configurator", roles: ["owner", "admin", "sales_manager", "sales", "production_manager", "production", "factory_manager", "inventory_manager", "accounts", "viewer"] },
  { prefix: "/machines", roles: ["owner", "admin", "production_manager", "production", "viewer"] },
  { prefix: "/tasks", roles: ["owner", "admin", "sales_manager", "sales", "production_manager", "production", "factory_manager", "dispatch_manager", "dispatch", "inventory_manager", "accounts", "quality", "viewer", "dealer_admin", "dealer_staff"] },
  { prefix: "/orders", roles: ["owner", "admin", "sales_manager", "sales", "production_manager", "production", "factory_manager", "dispatch_manager", "dispatch", "inventory_manager", "accounts", "quality", "viewer"] },
  { prefix: "/production/handover", roles: ["owner", "admin", "production_manager", "production", "factory_manager", "quality", "dispatch_manager", "viewer"] },
  { prefix: "/production", roles: ["owner", "admin", "production_manager", "production", "factory_manager", "viewer"] },
  { prefix: "/foundry", roles: ["owner", "admin", "production_manager", "production", "factory_manager", "viewer"] },
  { prefix: "/packaging", roles: ["owner", "admin", "production_manager", "production", "factory_manager", "dispatch_manager", "dispatch", "viewer"] },
  { prefix: "/quality", roles: ["owner", "admin", "production_manager", "quality", "viewer"] },
  { prefix: "/inventory/stock-balances", roles: ["owner", "admin", "production_manager", "production", "factory_manager", "inventory_manager", "dispatch_manager", "dispatch", "dealer_admin", "dealer_staff"] },
  { prefix: "/inventory", roles: ["owner", "admin", "production_manager", "production", "factory_manager", "dispatch_manager", "inventory_manager", "viewer", "dealer_admin", "dealer_staff"] },
  { prefix: "/dealer-inventory", roles: ["owner", "admin", "sales_manager", "factory_manager", "inventory_manager", "viewer", "dealer_admin", "dealer_staff"] },
  { prefix: "/vendors", roles: ["owner", "admin", "sales_manager", "production_manager", "accounts", "viewer"] },
  { prefix: "/shipments", roles: ["owner", "admin", "sales_manager", "sales", "factory_manager", "dispatch_manager", "dispatch", "inventory_manager", "accounts", "viewer"] },
  { prefix: "/dispatches", roles: ["owner", "admin", "sales_manager", "sales", "factory_manager", "dispatch_manager", "dispatch", "inventory_manager", "accounts", "viewer"] },
  { prefix: "/dealer-orders", roles: ["owner", "admin", "sales_manager", "sales", "factory_manager", "inventory_manager", "dealer_admin", "dealer_staff"] },
  { prefix: "/discrepancies", roles: ["owner", "admin", "factory_manager", "inventory_manager", "dealer_admin", "dealer_staff"] },
  { prefix: "/notifications", roles: ["owner", "admin", "sales_manager", "sales", "production_manager", "production", "factory_manager", "dispatch_manager", "dispatch", "inventory_manager", "accounts", "quality", "viewer", "dealer_admin", "dealer_staff"] },
  { prefix: "/search", roles: ["owner", "admin", "sales_manager", "sales", "production_manager", "production", "factory_manager", "dispatch_manager", "dispatch", "inventory_manager", "accounts", "quality", "viewer", "dealer_admin", "dealer_staff"] },
  { prefix: "/portal", roles: ["owner", "admin", "dealer_admin", "dealer_staff"] },
];

const dealerAllowedPrefixes = [
  "/dashboard",
  "/tasks",
  "/inventory",
  "/dealer-inventory",
  "/dealer-orders",
  "/discrepancies",
  "/portal",
  "/notifications",
  "/search",
];

function startsWithPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function matchingRule(pathname: string) {
  return [...roleRules]
    .sort((a, b) => b.prefix.length - a.prefix.length)
    .find((rule) => startsWithPrefix(pathname, rule.prefix));
}

function dealerRouteAllowed(pathname: string) {
  return dealerAllowedPrefixes.some((prefix) => startsWithPrefix(pathname, prefix));
}

export function isProtectedPath(pathname: string) {
  return protectedPrefixes.some((prefix) => startsWithPrefix(pathname, prefix));
}

export function hasRouteAccess(pathname: string, role: UserRole) {
  if (/^\/dispatches\/[^/]+\/returns$/.test(pathname)) return ["owner", "admin", "quality", "inventory_manager", "dispatch_manager", "accounts"].includes(role);
  if (startsWithPrefix(pathname, "/mobile/jobs")) return canAccessMobileDestination(role, "jobs");
  if (startsWithPrefix(pathname, "/mobile/scan")) return canAccessMobileDestination(role, "scan");
  if (startsWithPrefix(pathname, "/mobile/dispatch")) return canAccessMobileDestination(role, "dispatch");
  if (startsWithPrefix(pathname, "/mobile/quality")) return canAccessMobileDestination(role, "quality");
  if (startsWithPrefix(pathname, "/mobile/tasks")) return canAccessMobileDestination(role, "tasks");
  if (startsWithPrefix(pathname, "/mobile")) return canAccessMobileApp(role);
  if (startsWithPrefix(pathname, "/scan")) return canAccessMobileDestination(role, "scan");

  if (role === "dealer_admin" || role === "dealer_staff") {
    if (!dealerRouteAllowed(pathname)) return false;
    const dealerRule = matchingRule(pathname);
    return dealerRule ? dealerRule.roles.includes(role) : true;
  }
  const rule = matchingRule(pathname);
  if (!rule) return false;
  return rule.roles.includes(role);
}
