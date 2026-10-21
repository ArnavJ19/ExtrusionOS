import { can } from "../auth/permissions";
import type { UserRole } from "../../types/app";

export type FindResource = "customers" | "profiles" | "dies" | "quotes" | "orders" | "dispatches" | "dealer_orders";
export type FindResult = { id: string; resource: FindResource; title: string; detail: string; status: string; href: string; action?: { label: string; href: string } };
export type FindResponse = { query: string; items: FindResult[]; unavailable: string[]; error?: string };
export const findDefinitions = {
  customers: { table: "customers", columns: "id, customer_name, company_name, customer_type, city, gst_number", search: ["customer_name", "company_name", "gst_number", "city"], title: "customer_name", status: "customer_type", path: "/customers" },
  profiles: { table: "aluminium_profiles", columns: "id, profile_code, profile_name, application_category", search: ["profile_code", "profile_name"], title: "profile_code", status: "application_category", path: "/profiles" },
  dies: { table: "dies", columns: "id, die_number, die_status, rack_location", search: ["die_number", "rack_location"], title: "die_number", status: "die_status", path: "/dies" },
  quotes: { table: "quotes_authorized", columns: "id, quote_number, status", search: ["quote_number"], title: "quote_number", status: "status", path: "/quotes" },
  orders: { table: "orders_authorized", columns: "id, order_number, current_stage, customer_name, company_name", search: ["order_number", "customer_name", "company_name"], title: "order_number", status: "current_stage", path: "/orders" },
  dispatches: { table: "dispatches", columns: "id, dispatch_number, delivery_status, vehicle_number", search: ["dispatch_number", "vehicle_number"], title: "dispatch_number", status: "delivery_status", path: "/dispatches" },
  dealer_orders: { table: "dealer_orders", columns: "id, order_number, status", search: ["order_number"], title: "order_number", status: "status", path: "/dealer-orders" },
} as const;

export function cleanFindQuery(value: string) {
  return value.replace(/[^\p{L}\p{N}@\-/\s]/gu, " ").replace(/\s+/g, " ").trim();
}

export function findResult(resource: FindResource, row: Record<string, any>, role: UserRole): FindResult {
  const definition = findDefinitions[resource];
  const href = `${definition.path}/${encodeURIComponent(row.id)}`;
  const status = String(row[definition.status] ?? "");
  const result: FindResult = { id: row.id, resource, title: String(row[definition.title] || resource), status, href,
    detail: [row.company_name, row.profile_name, row.customer_name, row.city, row.gst_number, row.rack_location, row.vehicle_number].filter(Boolean).join(" / ") };
  if (resource === "quotes" && ["owner", "admin"].includes(role) && can(role, "create", "quotes")) result.action = { label: "Repeat quotation", href: `/quotes/new?repeat_from=${encodeURIComponent(row.id)}` };
  if (resource === "orders" && !["cancelled", "delivered"].includes(status) && can(role, "create", "dispatches")) result.action = { label: "Check dispatch readiness", href: `/dispatches/new?order_id=${encodeURIComponent(row.id)}` };
  return result;
}
