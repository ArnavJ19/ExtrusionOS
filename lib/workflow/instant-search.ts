import { can } from "../auth/permissions";
import { canReadImprovement } from "./improvement";
import type { UserRole } from "../../types/app";

export type FindResource = "customers" | "profiles" | "dies" | "quotes" | "orders" | "dispatches" | "dealer_orders";
export type FindResult = { id: string; resource: FindResource; title: string; detail: string; status: string; href: string; action?: { label: string; href: string } };
export type FindResponse = { query: string; items: FindResult[]; unavailable: string[]; error?: string };
type FindDefinition = { table: string; columns: string; search: readonly string[]; phones?: readonly string[]; title: string; status: string; path: string };
// NOV-003: identifiers employees actually know, per resource. Snippets carry no costing or margin.
export const findDefinitions: Record<FindResource, FindDefinition> = {
  customers: { table: "customers", columns: "id, customer_name, company_name, customer_type, city, gst_number, contact_person", search: ["customer_name", "company_name", "gst_number", "city", "contact_person"],
    phones: ["phone", "whatsapp_number"], title: "customer_name", status: "customer_type", path: "/customers" },
  profiles: { table: "aluminium_profiles", columns: "id, profile_code, profile_name, application_category", search: ["profile_code", "profile_name"], title: "profile_code", status: "application_category", path: "/profiles" },
  dies: { table: "dies", columns: "id, die_number, die_status, rack_location, die_code, customer_die_reference", search: ["die_number", "die_code", "customer_die_reference", "rack_location"], title: "die_number", status: "die_status", path: "/dies" },
  quotes: { table: "quotes_authorized", columns: "id, quote_number, status", search: ["quote_number"], title: "quote_number", status: "status", path: "/quotes" },
  orders: { table: "orders_authorized", columns: "id, order_number, current_stage, customer_name, company_name", search: ["order_number", "customer_name", "company_name"], title: "order_number", status: "current_stage", path: "/orders" },
  dispatches: { table: "dispatches", columns: "id, dispatch_number, delivery_status, vehicle_number", search: ["dispatch_number", "vehicle_number"], title: "dispatch_number", status: "delivery_status", path: "/dispatches" },
  dealer_orders: { table: "dealer_orders", columns: "id, order_number, status", search: ["order_number"], title: "order_number", status: "status", path: "/dealer-orders" },
};

export function cleanFindQuery(value: string) {
  return value.replace(/[^\p{L}\p{N}@\-/\s]/gu, " ").replace(/\s+/g, " ").trim();
}

/**
 * Search patterns for one query. A code typed with spaces, dashes or slashes also finds the same
 * characters with other separators ("AL 6063" finds "AL-6063"); results still show the exact code.
 */
export function findPatterns(query: string): string[] {
  const cleaned = cleanFindQuery(query);
  if (cleaned.length < 2) return [];
  const loose = cleaned.replace(/[\s\-/]+/g, "*");
  return loose === cleaned ? [cleaned] : [cleaned, loose];
}

/** Indian phone numbers are matched on their last ten digits whatever spacing or +91 prefix was stored. */
export function findPhonePattern(query: string): string | null {
  const digits = query.replace(/\D/g, "");
  if (digits.length < 6 || digits.length > 13 || digits.length < query.replace(/\s/g, "").length - 3) return null;
  return `*${digits.slice(-10).split("").join("*")}*`;
}

/** The PostgREST or-filter for one resource; every value has been reduced to letters, digits, @, - and /. */
export function findFilter(definition: FindDefinition, query: string) {
  const clauses = findPatterns(query).flatMap(pattern => definition.search.map(field => `${field}.ilike.*${pattern}*`));
  const phone = definition.phones ? findPhonePattern(query) : null;
  if (phone) clauses.push(...definition.phones!.map(field => `${field}.ilike.${phone}`));
  return clauses.join(",");
}

const compact = (value: string) => value.toLocaleLowerCase("en-IN").replace(/[\s\-/]+/g, "");
/** Exact identifier matches first, then prefix, then contains; resource order is kept within a tier. */
export function rankFindResults(items: FindResult[], query: string) {
  const target = compact(cleanFindQuery(query));
  const tier = (item: FindResult) => { const title = compact(item.title); return title === target ? 0 : title.startsWith(target) ? 1 : 2; };
  return items.map((item, index) => ({ item, index, tier: tier(item) })).sort((a, b) => a.tier - b.tier || a.index - b.index).map(entry => entry.item);
}

export function findResult(resource: FindResource, row: Record<string, any>, role: UserRole): FindResult {
  const definition = findDefinitions[resource];
  const href = `${definition.path}/${encodeURIComponent(row.id)}`;
  const status = String(row[definition.status] ?? "");
  const result: FindResult = { id: row.id, resource, title: String(row[definition.title] || resource), status, href,
    detail: [row.company_name, row.profile_name, row.customer_name, row.contact_person, row.city, row.gst_number, row.die_code, row.customer_die_reference, row.rack_location, row.vehicle_number].filter(Boolean).join(" / ") };
  if (resource === "quotes" && ["owner", "admin"].includes(role) && can(role, "create", "quotes")) result.action = { label: "Repeat quotation", href: `/quotes/new?repeat_from=${encodeURIComponent(row.id)}` };
  if (resource === "orders" && !["cancelled", "delivered"].includes(status) && can(role, "create", "dispatches")) result.action = { label: "Check dispatch readiness", href: `/dispatches/new?order_id=${encodeURIComponent(row.id)}` };
  if (resource === "dies" && canReadImprovement(role, "dies")) result.action = { label: "View operating history", href: `/tasks/improvement/dies/${encodeURIComponent(row.id)}` };
  return result;
}
