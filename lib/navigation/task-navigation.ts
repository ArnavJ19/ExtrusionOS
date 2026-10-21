import type { EnterpriseModuleName, UserRole } from "@/types/app";

export type TaskNavigationItem = {
  href: string;
  label: string;
  icon: string;
  roles: UserRole[];
  module?: EnterpriseModuleName;
  aliases?: string[];
};

export type TaskNavigationGroup = {
  label: string;
  items: TaskNavigationItem[];
};

export type TaskNavigationModel = {
  primary: TaskNavigationItem[];
  more: TaskNavigationGroup[];
};

const rolePriorities: Partial<Record<UserRole, string[]>> = {
  owner: ["/dashboard", "/command-center", "/orders", "/quotes", "/tasks"],
  admin: ["/dashboard", "/command-center", "/orders", "/quotes", "/tasks"],
  sales_manager: ["/dashboard", "/quotes", "/customers", "/orders", "/tasks"],
  sales: ["/dashboard", "/quotes", "/customers", "/orders", "/tasks"],
  production_manager: ["/dashboard", "/production", "/orders", "/tasks", "/foundry"],
  production: ["/dashboard", "/production", "/orders", "/tasks", "/foundry"],
  factory_manager: ["/dashboard", "/production", "/orders", "/dispatches", "/tasks"],
  dispatch_manager: ["/dashboard", "/dispatches", "/orders", "/tasks", "/packaging"],
  dispatch: ["/dashboard", "/dispatches", "/orders", "/tasks", "/packaging"],
  inventory_manager: ["/dashboard", "/inventory", "/orders", "/dispatches", "/tasks"],
  accounts: ["/dashboard", "/invoices", "/payments", "/expenses", "/tasks"],
  quality: ["/dashboard", "/quality", "/orders", "/tasks", "/profiles"],
  viewer: ["/dashboard", "/orders", "/reports", "/tasks", "/inventory"],
  dealer_admin: ["/dashboard", "/dealer-orders", "/dealer-inventory", "/tasks"],
  dealer_staff: ["/dashboard", "/dealer-orders", "/dealer-inventory", "/tasks"]
};

const groupByHref: Record<string, string> = {
  "/dashboard": "Daily work", "/command-center": "Daily work", "/tasks": "Daily work",
  "/customers": "Sales", "/crm": "Sales", "/quotes": "Sales", "/ai/quotation-assistant": "Sales", "/systems-configurator": "Sales", "/communications/whatsapp": "Sales", "/tenders": "Sales",
  "/orders": "Factory", "/production": "Factory", "/foundry": "Factory", "/packaging": "Factory", "/quality": "Factory", "/dies": "Factory", "/die-intelligence": "Factory", "/machines": "Factory", "/maintenance": "Factory", "/energy": "Factory",
  "/inventory": "Stock", "/profiles": "Stock", "/dealer-inventory": "Stock", "/vendors": "Stock", "/barcode": "Stock", "/scan": "Stock", "/mobile": "Stock", "/discrepancies": "Stock",
  "/dispatches": "Dispatch", "/dealer-orders": "Dispatch", "/exports": "Dispatch",
  "/expenses": "Accounts", "/invoices": "Accounts", "/payments": "Accounts", "/profitability": "Accounts", "/reports": "Accounts", "/analytics": "Accounts",
  "/documents": "Records", "/compliance": "Records", "/automation": "Records", "/audit-logs": "Records",
  "/settings": "Administration", "/settings/access": "Administration", "/settings/enterprise": "Administration", "/settings/security": "Administration", "/settings/branding": "Administration", "/settings/data": "Administration", "/settings/integrations": "Administration"
};

const groupOrder = ["Daily work", "Sales", "Factory", "Stock", "Dispatch", "Accounts", "Records", "Administration", "Other tools"];

export function buildTaskNavigation(options: {
  items: TaskNavigationItem[];
  role: UserRole;
  featureFlags: Partial<Record<EnterpriseModuleName, boolean>>;
  hasRouteAccess: (href: string, role: UserRole) => boolean;
  isFeatureEnabled: (flags: Partial<Record<EnterpriseModuleName, boolean>>, module: EnterpriseModuleName) => boolean;
  primaryLimit?: number;
}): TaskNavigationModel {
  const unique = new Map<string, TaskNavigationItem>();
  for (const item of options.items) {
    if (unique.has(item.href)) continue;
    if (!item.roles.includes(options.role) || !options.hasRouteAccess(item.href, options.role)) continue;
    if (item.module && !options.isFeatureEnabled(options.featureFlags, item.module)) continue;
    unique.set(item.href, item);
  }

  const allowed = [...unique.values()];
  const priority = rolePriorities[options.role] ?? ["/dashboard", "/tasks", "/orders"];
  const prioritized = allowed
    .map((item, index) => ({ item, index, priority: priority.indexOf(item.href) }))
    .sort((a, b) => {
      const left = a.priority < 0 ? Number.MAX_SAFE_INTEGER : a.priority;
      const right = b.priority < 0 ? Number.MAX_SAFE_INTEGER : b.priority;
      return left - right || a.index - b.index;
    })
    .map(({ item }) => item);
  const primary = prioritized.slice(0, options.primaryLimit ?? 5);
  const primaryHrefs = new Set(primary.map((item) => item.href));
  const sections = new Map<string, TaskNavigationItem[]>();

  for (const item of allowed) {
    if (primaryHrefs.has(item.href)) continue;
    const group = groupByHref[item.href] ?? "Other tools";
    sections.set(group, [...(sections.get(group) ?? []), item]);
  }

  const more = groupOrder
    .filter((label) => sections.has(label))
    .map((label) => ({ label, items: sections.get(label)! }));

  return { primary, more };
}
