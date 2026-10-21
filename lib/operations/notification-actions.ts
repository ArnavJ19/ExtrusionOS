import { can, type Resource } from "@/lib/auth/permissions";
import type { SessionContext } from "@/types/app";

export type ActionableNotification = { id: string; notification_type?: string; related_entity_type?: string | null; related_entity_id?: string | null; entity_reference?: string | null };
export type NotificationAction = { href: string | null; label: string; state: "active" | "resolved" | "restricted" | "unavailable" | "unlinked"; detail: string; responsible: string | null };
type Target = { table: string; select: string; path: string; resource: Resource; team: string; softDelete?: boolean };
const targets: Record<string, Target> = {
  order: { table: "orders_authorized", select: "id,current_stage", path: "/orders", resource: "orders", team: "Order team", softDelete: true },
  quote: { table: "quotes_authorized", select: "id,status", path: "/quotes", resource: "quotes", team: "Sales", softDelete: true },
  invoice: { table: "invoices_authorized", select: "id,status,balance_due,due_date", path: "/invoices", resource: "financials", team: "Accounts", softDelete: true },
  task: { table: "tasks", select: "id,status", path: "/tasks", resource: "tasks", team: "Task assignee" },
  production_job: { table: "production_jobs", select: "id,status", path: "/production", resource: "production", team: "Production" },
  inventory_item: { table: "inventory_items", select: "id,current_stock,reorder_level", path: "/inventory", resource: "inventory", team: "Inventory" },
  die: { table: "dies", select: "id,die_status", path: "/dies", resource: "dies", team: "Die management" },
  dispatch: { table: "dispatches", select: "id,delivery_status", path: "/dispatches", resource: "dispatches", team: "Dispatch" },
  quality_inspection: { table: "quality_inspections", select: "id", path: "/quality", resource: "quality", team: "Quality" },
  customer: { table: "customers", select: "id,is_active", path: "/customers", resource: "customers", team: "Sales", softDelete: true },
  dealer_order: { table: "dealer_orders", select: "id,status", path: "/dealer-orders", resource: "dealer_orders", team: "Dealer order team" }
};
const singular: Record<string, string> = { orders: "order", quotes: "quote", invoices: "invoice", tasks: "task", production_jobs: "production_job", inventory_items: "inventory_item", dies: "die", dispatches: "dispatch", customers: "customer", dealer_orders: "dealer_order" };
const validId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
export function notificationTarget(value: string | null | undefined) {
  const key = value ?? "", canonical = Object.hasOwn(singular, key) ? singular[key] : key;
  return Object.hasOwn(targets, canonical) ? targets[canonical] : null;
}

export function evaluateNotificationAction(notification: ActionableNotification, target: Target, row: Record<string, unknown>, today: string): NotificationAction {
  const type = notification.notification_type ?? "";
  let resolved = false;
  if (["overdue_invoice", "invoice_overdue", "payment_overdue"].includes(type)) {
    const balance = row.balance_due === null || row.balance_due === undefined ? NaN : Number(row.balance_due);
    resolved = Number.isFinite(balance) && balance >= 0 && (balance === 0 || ["paid", "cancelled"].includes(String(row.status)) || (typeof row.due_date === "string" && row.due_date >= today));
  } else if (["low_stock", "inventory_low_stock", "reorder_alert"].includes(type)) {
    const stock = row.current_stock == null ? NaN : Number(row.current_stock), reorder = row.reorder_level == null ? NaN : Number(row.reorder_level);
    resolved = Number.isFinite(stock) && Number.isFinite(reorder) && stock >= 0 && reorder >= 0 && stock > reorder;
  } else if (target.path === "/tasks") resolved = ["completed", "cancelled"].includes(String(row.status));
  else if (target.path === "/orders" && ["overdue_order", "order_overdue"].includes(type)) resolved = ["delivered", "cancelled"].includes(String(row.current_stage));
  else if (target.path === "/quotes" && ["quote_approval_required", "quote_pending_approval"].includes(type)) resolved = ["approved", "accepted", "rejected", "expired", "converted"].includes(String(row.status));
  const discussion = type === "record_mention" && validId(notification.entity_reference) && ["/orders", "/production", "/dispatches", "/quality"].includes(target.path);
  return { href: `${target.path}/${notification.related_entity_id}${discussion ? `?discussion=${notification.entity_reference}#record-discussion` : ""}`, label: discussion ? "Open internal discussion" : "Open source record", state: resolved ? "resolved" : "active", detail: resolved ? "The recorded alert condition is no longer outstanding in the current source record." : "Review the source record for its current status and available actions.", responsible: target.team };
}

export async function loadNotificationActions(client: { from: (table: string) => any }, context: SessionContext, notifications: ActionableNotification[], today: string): Promise<Record<string, NotificationAction>> {
  const actions: Record<string, NotificationAction> = {};
  const groups = new Map<string, { target: Target; notifications: ActionableNotification[] }>();
  for (const notification of notifications.slice(0, 10)) {
    const target = notificationTarget(notification.related_entity_type);
    if (!target || !validId(notification.related_entity_id)) { actions[notification.id] = { href: null, label: "", state: "unlinked", detail: "No verified source link was recorded with this message.", responsible: null }; continue; }
    if (!can(context.role, "read", target.resource) || (notification.notification_type === "record_mention" && (context.dealerId || ["dealer_admin", "dealer_staff"].includes(context.role)))) { actions[notification.id] = { href: null, label: "", state: "restricted", detail: "Your role cannot open this source record.", responsible: target.team }; continue; }
    const group = groups.get(target.table) ?? { target, notifications: [] };
    group.notifications.push(notification); groups.set(target.table, group);
  }
  await Promise.all([...groups.values()].map(async ({ target, notifications: items }) => {
    try {
      let query = client.from(target.table).select(target.select).eq("company_id", context.companyId).in("id", [...new Set(items.map(item => item.related_entity_id))]);
      if (target.softDelete) query = query.is("deleted_at", null);
      const result = await query.limit(10);
      const rows = new Map<string, Record<string, unknown>>((result.data ?? []).map((row: Record<string, unknown>) => [String(row.id), row]));
      for (const notification of items) {
        const row = rows.get(notification.related_entity_id!);
        actions[notification.id] = result.error || !row ? { href: null, label: "", state: "unavailable", detail: result.error ? "The current source state could not be verified. Refresh to retry." : "The source is no longer available in your permitted records.", responsible: target.team } : evaluateNotificationAction(notification, target, row, today);
      }
    } catch {
      for (const notification of items) actions[notification.id] = { href: null, label: "", state: "unavailable", detail: "The current source state could not be verified. Refresh to retry.", responsible: target.team };
    }
  }));
  return actions;
}
