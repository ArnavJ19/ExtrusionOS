import { can } from "@/lib/auth/permissions";
import type { UserRole } from "@/types/app";

export type PreferenceColumn = { id: string; header: string; sortable?: boolean };
export type ColumnLayout = { order: string[]; hidden: string[]; widths: Record<string, number> };

const roleOrder: Partial<Record<UserRole, Record<string, string[]>>> = {
  accounts: {
    orders: ["order_number", "customer", "current_stage", "expected_dispatch_date", "order_value", "priority"],
    dispatches: ["dispatch_number", "order", "customer", "dispatch_date", "delivery_status", "total_weight_kg"],
    invoices: ["invoice_number", "customer", "status", "due_date", "balance_due", "grand_total", "amount_paid"],
    expenses: ["expense_number", "created_at", "expense_category", "vendor", "total_amount", "amount_paid", "balance_amount", "payment_status"]
  },
  dispatch: {
    orders: ["order_number", "customer", "current_stage", "expected_dispatch_date", "priority", "billet_allocation_status"],
    dispatches: ["dispatch_number", "order", "customer", "delivery_status", "dispatch_date", "vehicle_number", "transporter_name", "total_weight_kg"],
    packaging: ["packaging_number", "order", "status", "scheduled_date", "pieces", "profile_weight_kg"]
  },
  dispatch_manager: {
    orders: ["order_number", "customer", "current_stage", "expected_dispatch_date", "priority", "billet_allocation_status"],
    dispatches: ["dispatch_number", "order", "customer", "delivery_status", "dispatch_date", "vehicle_number", "transporter_name", "total_weight_kg"]
  },
  production: {
    orders: ["order_number", "current_stage", "priority", "expected_dispatch_date", "billets_required", "billets_allocated", "billet_allocation_status"],
    production: ["job_number", "status", "planned_date", "order", "profile", "planned_quantity_kg", "pieces"]
  },
  production_manager: {
    orders: ["order_number", "customer", "current_stage", "priority", "expected_dispatch_date", "billets_required", "billets_allocated"],
    production: ["job_number", "status", "planned_date", "order", "profile", "planned_quantity_kg", "pieces"]
  }
};

const restrictedColumns: Record<string, Record<string, readonly UserRole[]>> = {
  orders: { order_value: ["owner", "admin", "sales_manager", "sales", "accounts", "dealer_admin", "dealer_staff"] },
  quotes: { grand_total: ["owner", "admin", "sales_manager", "sales", "accounts", "dealer_admin", "dealer_staff"] },
  invoices: { grand_total: ["owner", "admin", "accounts"], balance_due: ["owner", "admin", "accounts"] },
  payments: { amount: ["owner", "admin", "accounts"] },
  expenses: { total_amount: ["owner", "admin", "accounts"], amount_paid: ["owner", "admin", "accounts"], balance_amount: ["owner", "admin", "accounts"] },
  expense_payments: { amount_paid: ["owner", "admin", "accounts"] }
};

export function canReadPreferredColumn(moduleKey: string, columnId: string, role: UserRole): boolean {
  const allowlist = restrictedColumns[moduleKey]?.[columnId];
  if (allowlist) return allowlist.includes(role);
  if (["invoices", "payments", "expenses", "expense_payments"].includes(moduleKey)) return can(role, "read", "financials");
  return true;
}

export function getRoleColumnOrder(moduleKey: string, role: UserRole, columns: readonly PreferenceColumn[]): string[] {
  const available = new Set(columns.map((column) => column.id));
  const configured = roleOrder[role]?.[moduleKey] ?? [];
  return [...configured.filter((id) => available.has(id)), ...columns.map((column) => column.id).filter((id) => !configured.includes(id))];
}

export function resolveColumnLayout<T extends PreferenceColumn>(
  moduleKey: string,
  role: UserRole,
  columns: readonly T[],
  preferences: ColumnLayout | undefined
): { columns: T[]; permittedColumns: T[]; widths: Record<string, number>; identifier: string } {
  const allowed = columns.filter((column) => canReadPreferredColumn(moduleKey, column.id, role));
  const available = new Set(allowed.map((column) => column.id));
  const identifier = allowed[0]?.id ?? "";
  const hidden = new Set(preferences?.hidden ?? []);
  const customOrder = preferences?.order?.filter((id) => available.has(id)) ?? [];
  const defaultOrder = getRoleColumnOrder(moduleKey, role, allowed);
  const order = [...new Set([...customOrder, ...defaultOrder])].filter((id) => id === identifier || !hidden.has(id));
  if (identifier && order[0] !== identifier) {
    order.splice(Math.max(0, order.indexOf(identifier)), 1);
    order.unshift(identifier);
  }
  const byId = new Map(allowed.map((column) => [column.id, column]));
  const widths: Record<string, number> = {};
  for (const [id, value] of Object.entries(preferences?.widths ?? {})) if (available.has(id) && Number.isFinite(value)) widths[id] = Math.max(80, Math.min(480, Math.round(value)));
  return { columns: order.flatMap((id) => byId.has(id) ? [byId.get(id)!] : []), permittedColumns: allowed, widths, identifier };
}

export function moveColumn<T extends PreferenceColumn>(columns: readonly T[], columnId: string, offset: -1 | 1, identifier: string): T[] {
  const next = [...columns];
  const index = next.findIndex((column) => column.id === columnId);
  const target = index + offset;
  if (index < 0 || target < 0 || target >= next.length || columnId === identifier || next[target]?.id === identifier) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
