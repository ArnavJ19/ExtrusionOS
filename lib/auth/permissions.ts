import type { UserRole } from "@/types/app";

export type Resource = "quotes" | "orders" | "inventory" | "dealer_inventory" | "dealer_orders" | "shipments" | "production" | "foundry" | "packaging" | "dies" | "dispatches" | "settings" | "quality" | "customers" | "profiles" | "financials" | "vendors" | "enterprise" | "branches" | "feature_flags" | "audit_logs" | "notifications" | "tasks" | "data_exchange" | "search" | "ai_assistant" | "systems_configurator" | "users" | "roles" | "reports" | "payments" | "machine_maintenance";
export type Action = "create" | "read" | "update" | "delete" | "approve";

export const granularPermissions = [
  "view_quotes", "create_quotes", "edit_quotes", "delete_quotes", "approve_quotes",
  "view_orders", "create_orders", "edit_orders", "cancel_orders", "approve_orders",
  "view_inventory", "edit_inventory", "adjust_inventory", "approve_inventory_adjustments",
  "view_dealer_inventory", "edit_dealer_inventory", "receive_dealer_inventory",
  "view_factory_inventory", "manage_shipments", "manage_users", "manage_roles",
  "view_audit_logs", "export_reports", "manage_company_settings", "manage_tasks", "manage_payments"
] as const;

export type GranularPermission = typeof granularPermissions[number];

export const defaultRolePermissions: Record<string, GranularPermission[]> = {
  owner: [...granularPermissions],
  admin: granularPermissions.filter((permission) => !["manage_company_settings", "manage_users", "manage_roles"].includes(permission)),
  sales: ["view_quotes", "create_quotes", "edit_quotes", "view_orders", "create_orders", "view_inventory"],
  sales_manager: ["view_quotes", "create_quotes", "edit_quotes", "approve_quotes", "view_orders", "create_orders", "edit_orders", "view_inventory", "export_reports"],
  factory_manager: ["view_orders", "edit_orders", "view_inventory", "edit_inventory", "view_factory_inventory", "manage_shipments"],
  production_manager: ["view_orders", "edit_orders", "view_inventory", "edit_inventory", "view_factory_inventory", "manage_shipments"],
  production: ["view_orders", "edit_orders", "view_inventory", "view_factory_inventory"],
  inventory_manager: ["view_inventory", "edit_inventory", "adjust_inventory", "view_factory_inventory", "manage_shipments"],
  dispatch_manager: ["view_orders", "edit_orders", "view_inventory", "manage_shipments"],
  dispatch: ["view_orders", "view_inventory", "manage_shipments"],
  dealer_admin: ["view_quotes", "create_quotes", "edit_quotes", "view_orders", "create_orders", "view_inventory", "view_dealer_inventory", "edit_dealer_inventory", "receive_dealer_inventory", "view_audit_logs"],
  dealer_staff: ["view_quotes", "create_quotes", "view_orders", "create_orders", "view_inventory", "view_dealer_inventory", "edit_dealer_inventory", "receive_dealer_inventory"],
  accounts: ["view_orders", "view_quotes", "export_reports", "manage_payments"],
  quality: ["view_orders", "edit_orders", "view_inventory"],
  viewer: ["view_quotes", "view_orders", "view_inventory", "view_dealer_inventory", "view_audit_logs"]
};

const actionPermissionMap: Partial<Record<Resource, Partial<Record<Action, GranularPermission>>>> = {
  quotes: { read: "view_quotes", create: "create_quotes", update: "edit_quotes", delete: "delete_quotes", approve: "approve_quotes" },
  orders: { read: "view_orders", create: "create_orders", update: "edit_orders", delete: "cancel_orders", approve: "approve_orders" },
  dealer_orders: { read: "view_orders", create: "create_orders", update: "edit_orders", delete: "cancel_orders", approve: "approve_orders" },
  inventory: { read: "view_inventory", create: "edit_inventory", update: "edit_inventory", delete: "adjust_inventory", approve: "approve_inventory_adjustments" },
  dealer_inventory: { read: "view_dealer_inventory", create: "edit_dealer_inventory", update: "edit_dealer_inventory", approve: "receive_dealer_inventory" },
  shipments: { read: "manage_shipments", create: "manage_shipments", update: "manage_shipments", delete: "manage_shipments" },
  users: { read: "manage_users", create: "manage_users", update: "manage_users", delete: "manage_users" },
  roles: { read: "manage_roles", create: "manage_roles", update: "manage_roles", delete: "manage_roles" },
  audit_logs: { read: "view_audit_logs" },
  reports: { read: "export_reports", create: "export_reports" },
  settings: { read: "manage_company_settings", update: "manage_company_settings" },
  tasks: { read: "manage_tasks", create: "manage_tasks", update: "manage_tasks", delete: "manage_tasks" },
  payments: { read: "manage_payments", create: "manage_payments", update: "manage_payments", delete: "manage_payments" }
};

export function hasPermission(role: UserRole, permission: GranularPermission, extraPermissions: string[] = []) {
  if (role === "owner") return true;
  return extraPermissions.includes(permission) || (defaultRolePermissions[role] ?? []).includes(permission);
}

export function can(role: UserRole, action: Action, resource: Resource): boolean {
  if (resource === "roles") return role === "owner";
  if (resource === "users") {
    if (role === "owner") return true;
    if (role === "dealer_admin") return true;
    return false;
  }
  if (resource === "orders" && ["dealer_admin", "dealer_staff"].includes(role)) return false;

  const permission = actionPermissionMap[resource]?.[action];
  if (permission && hasPermission(role, permission)) return true;


  if (role === "owner") return true;
  if (role === "admin") return true;

  if (role === "sales_manager") {
    if (resource === "tasks" && ["read", "create", "update"].includes(action)) return true;
    if (["quotes", "customers", "orders", "dies", "vendors", "ai_assistant", "systems_configurator"].includes(resource)) {
      if (action === "delete") return false;
      return true;
    }
  }

  if (role === "sales") {
    if (["quotes", "customers"].includes(resource) && ["create", "read", "update"].includes(action)) return true;
    if (resource === "systems_configurator" && ["create", "read", "update"].includes(action)) return true;
    if (resource === "ai_assistant" && ["create", "read"].includes(action)) return true;
    if (["orders", "dies"].includes(resource) && action === "read") return true;
  }

  if (role === "production_manager") {
    if (resource === "systems_configurator" && action === "read") return true;
    if (["production", "foundry", "packaging", "orders", "dies", "inventory", "quality", "vendors"].includes(resource) && action !== "delete") return true;
    if (["customers", "profiles"].includes(resource) && action === "read") return true;
  }

  if (role === "factory_manager") {
    if (resource === "tasks" && ["read", "create", "update"].includes(action)) return true;
    if (["production", "foundry", "packaging", "orders", "inventory", "dealer_orders", "shipments", "dispatches"].includes(resource) && action !== "delete") return true;
    if (["customers", "profiles"].includes(resource) && action === "read") return true;
  }

  if (role === "inventory_manager") {
    if (["inventory", "dealer_inventory", "shipments", "dispatches"].includes(resource) && action !== "delete") return true;
    if (["orders", "profiles"].includes(resource) && action === "read") return true;
  }

  if (role === "dealer_admin") {
    if (resource === "dealer_orders") return ["read", "create"].includes(action);
    if (resource === "tasks") return ["read", "create", "update"].includes(action);
    if (["quotes", "dealer_inventory", "dealer_orders", "shipments", "notifications"].includes(resource) && action !== "delete") return true;
  }

  if (role === "dealer_staff") {
    if (resource === "dealer_orders") return ["read", "create"].includes(action);
    if (resource === "tasks") return ["read", "create", "update"].includes(action);
    if (["quotes", "dealer_inventory", "dealer_orders", "shipments", "notifications"].includes(resource) && ["read", "create", "update", "approve"].includes(action)) return true;
  }

  if (role === "production") {
    if (resource === "systems_configurator" && action === "read") return true;
    if (resource === "production" && ["read", "update"].includes(action)) return true;
    if (resource === "foundry" && ["read", "create", "update"].includes(action)) return true;
    if (resource === "packaging" && ["read", "create", "update"].includes(action)) return true;
    if (["orders", "dies"].includes(resource) && action === "read") return true;
  }

  if (role === "dispatch_manager") {
    if (["dispatches", "orders", "packaging"].includes(resource) && action !== "delete") return true;
  }

  if (role === "dispatch") {
    if (["dispatches", "packaging"].includes(resource) && ["read", "create", "update"].includes(action)) return true;
  }

  if (role === "accounts") {
    if (resource === "settings" && action === "read") return true;
    if (resource === "financials" && ["read", "create", "update"].includes(action)) return true;
    if (["customers", "orders", "dispatches", "dies", "financials", "vendors", "notifications", "tasks", "search"].includes(resource) && action === "read") return true;
    // Accounts can manage invoices/financials
    if (resource === "quotes" && action === "read") return true;
  }

  if (role === "quality") {
    if (resource === "quality" && action !== "delete") return true;
    if (["orders", "production", "foundry"].includes(resource) && action === "read") return true;
  }

  if (role === "viewer") {
    if (action === "read" && ["quotes", "orders", "inventory", "dispatches", "production", "dies", "profiles", "customers", "quality", "reports", "audit_logs", "dealer_inventory", "dealer_orders"].includes(resource)) return true;
  }

  if (["notifications", "tasks", "search"].includes(resource) && action === "read") return true;

  return false;
}
