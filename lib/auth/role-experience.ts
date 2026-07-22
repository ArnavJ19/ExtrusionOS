import type { UserRole } from "@/types/app";
import { can, type Resource } from "./permissions.ts";

export type DashboardView = "owner" | "sales" | "operations";

export type DashboardExperience = {
  allowedViews: DashboardView[];
  initialView: DashboardView;
  canSeeCommercial: boolean;
  canSeeOperations: boolean;
  operationalResources: DashboardOperationalResource[];
  operationsHref: string;
};

export type DashboardOperationalResource = "production" | "dispatches" | "quality" | "inventory" | "dies";

function getOperationalResources(role: UserRole): DashboardOperationalResource[] {
  return (["production", "dispatches", "quality", "inventory", "dies"] as const)
    .filter((resource) => can(role, "read", resource));
}

function getOperationsHref(role: UserRole): string {
  if (role === "inventory_manager") return "/inventory";
  if (role === "dispatch_manager" || role === "dispatch") return "/dispatches";
  if (role === "quality") return "/quality";
  return "/production";
}

export function getDashboardExperience(role: UserRole): DashboardExperience {
  if (role === "owner" || role === "admin") {
    return {
      allowedViews: ["owner", "sales", "operations"],
      initialView: "owner",
      canSeeCommercial: true,
      canSeeOperations: true,
      operationalResources: getOperationalResources(role),
      operationsHref: getOperationsHref(role),
    };
  }

  if (["sales_manager", "sales", "accounts"].includes(role)) {
    return {
      allowedViews: ["sales"],
      initialView: "sales",
      canSeeCommercial: true,
      canSeeOperations: false,
      operationalResources: [],
      operationsHref: getOperationsHref(role),
    };
  }

  return {
    allowedViews: ["operations"],
    initialView: "operations",
    canSeeCommercial: false,
    canSeeOperations: true,
    operationalResources: getOperationalResources(role),
    operationsHref: getOperationsHref(role),
  };
}

export const searchResourceDefinitions = [
  { key: "customers", resource: "customers" },
  { key: "profiles", resource: "profiles" },
  { key: "dies", resource: "dies" },
  { key: "quotes", resource: "quotes" },
  { key: "orders", resource: "orders" },
  { key: "dispatches", resource: "dispatches" },
] as const satisfies readonly { key: string; resource: Resource }[];

export type SearchResourceKey = (typeof searchResourceDefinitions)[number]["key"];

export function getSearchResourceKeys(role: UserRole): SearchResourceKey[] {
  return searchResourceDefinitions
    .filter((definition) => can(role, "read", definition.resource))
    .map((definition) => definition.key);
}

export const mobileDestinationDefinitions = [
  { key: "jobs", resource: "production" },
  { key: "scan", resource: "inventory" },
  { key: "dispatch", resource: "dispatches" },
  { key: "quality", resource: "quality" },
  { key: "tasks", resource: "tasks" },
] as const satisfies readonly { key: string; resource: Resource }[];

export type MobileDestinationKey = (typeof mobileDestinationDefinitions)[number]["key"];

const mobileAppRoles: UserRole[] = [
  "owner",
  "admin",
  "production_manager",
  "production",
  "factory_manager",
  "dispatch_manager",
  "dispatch",
  "inventory_manager",
  "quality",
];

export function canAccessMobileApp(role: UserRole): boolean {
  return mobileAppRoles.includes(role);
}

export function canAccessMobileDestination(role: UserRole, destination: MobileDestinationKey): boolean {
  if (!canAccessMobileApp(role)) return false;
  const definition = mobileDestinationDefinitions.find((item) => item.key === destination);
  return Boolean(definition && can(role, "read", definition.resource));
}

export function getMobileDestinationKeys(role: UserRole): MobileDestinationKey[] {
  return mobileDestinationDefinitions
    .filter((definition) => canAccessMobileDestination(role, definition.key))
    .map((definition) => definition.key);
}
