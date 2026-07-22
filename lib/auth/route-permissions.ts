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
  { prefix: "/settings/access", roles: ["owner"] },
  { prefix: "/settings", roles: ["owner", "admin"] },
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
  { prefix: "/payments", roles: ["owner", "admin", "accounts", "viewer"] },
  { prefix: "/portal", roles: ["owner", "admin", "dealer_admin", "dealer_staff"] },
];

const dealerAllowedPrefixes = [
  "/dashboard",
  "/quotes",
  "/tasks",
  "/inventory",
  "/dealer-orders",
  "/discrepancies",
  "/portal",
  "/notifications",
  "/search",
];

const defaultEmployeeRoles: UserRole[] = [
  "owner",
  "admin",
  "sales_manager",
  "sales",
  "production_manager",
  "production",
  "factory_manager",
  "dispatch_manager",
  "dispatch",
  "inventory_manager",
  "accounts",
  "quality",
  "viewer",
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
  if (!rule) return isProtectedPath(pathname) && defaultEmployeeRoles.includes(role);
  return rule.roles.includes(role);
}
