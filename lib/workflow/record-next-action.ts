import { can } from "../auth/permissions.ts";
import { hasRouteAccess } from "../auth/route-permissions.ts";
import type { UserRole } from "../../types/app.ts";

export type NextActionRecord = { kind: "quote" | "order" | "production" | "dispatch" | "invoice" | "quality" | "packaging"; id: string; status: string; updatedAt?: string | null; linkedOrderId?: string | null; completeCosting?: boolean };
export type NextRecordAction = { label: string; href?: string; reason: string; source?: { kind: NextActionRecord["kind"]; id: string; status: string; version: string | null }; readiness?: "review_required" | "restricted" };
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const orderPlanningStages = ["order_confirmed", "die_ready", "billet_ready"];
const orderProductionStages = ["billet_heating", "extrusion_planned", "extruded", "stretching", "cutting", "aging", "surface_treatment", "finishing"];

export function nextRecordAction(role: UserRole, record: NextActionRecord, dealerId?: string | null): NextRecordAction | null {
  const action = deriveNextRecordAction(role, record, dealerId);
  if (!action) return null;
  if (action.href && !hasRouteAccess(action.href.split(/[?#]/)[0], role)) return null;
  return { ...action, source: { kind: record.kind, id: record.id, status: record.status, version: record.updatedAt ?? null }, readiness: action.href ? "review_required" : "restricted" };
}

function deriveNextRecordAction(role: UserRole, record: NextActionRecord, dealerId?: string | null): NextRecordAction | null {
  if (dealerId || role.startsWith("dealer") || !idPattern.test(record.id)) return null;
  const id = encodeURIComponent(record.id);
  if (record.kind === "quote") {
    if (!can(role, "read", "quotes")) return null;
    if (record.linkedOrderId && idPattern.test(record.linkedOrderId) && can(role, "read", "orders")) return { label: "Continue with the linked order", href: `/orders/${record.linkedOrderId}`, reason: "This quotation already has an order. Repeated conversion opens that order." };
    if (record.status === "customer_approved" && can(role, "create", "orders")) return { label: "Review accepted revision and create order", href: `/quotes/${id}/review`, reason: "Conversion rechecks the exact revision, saved totals and drawing approvals under a database lock." };
    if (["draft", "internal_review"].includes(record.status) && ["owner", "admin"].includes(role)) return { label: record.completeCosting === false ? "Complete quotation costing" : "Review quotation before issuing", href: record.completeCosting === false ? `/quotes/${id}/edit` : `/quotes/${id}/review`, reason: "Every line needs complete costing before the quotation can be issued." };
    if (can(role, "update", "quotes") && ["approved_for_sending", "sent"].includes(record.status)) return { label: "Record the next customer decision", href: `/quotes/${id}#quote-workflow`, reason: "Use the permitted status transitions below. Acceptance is required before order creation." };
    return { label: "Quotation workflow", reason: record.status === "converted_to_order" ? "The quotation was converted. Open its linked order from the recorded order list." : "A commercial employee must prepare and obtain acceptance of the current revision." };
  }
  if (record.kind === "order") {
    if (!can(role, "read", "orders")) return null;
    if (["cancelled", "delivered", "closed"].includes(record.status)) return { label: "Review completed or cancelled work", reason: "New dispatch preparation is unavailable for this order state. Existing shipments and corrections retain their own history." };
    // The stage decides which department acts next; a dispatch form is only offered once material is being packed or shipped.
    if (["packing", "dispatched"].includes(record.status) && can(role, "create", "dispatches")) return { label: "Review available material for dispatch", href: `/dispatches/new?order_id=${id}`, reason: "The order is preselected. Packing, source eligibility and remaining quantities are checked before posting." };
    if (orderPlanningStages.includes(record.status) && can(role, "create", "production")) return { label: "Plan production for this order", href: `/production/new?order_id=${id}`, reason: "The order is preselected. The order line, die, billets and press are rechecked when the job is saved." };
    if (record.status === "payment_pending" && can(role, "read", "financials")) return { label: "Review billing and receipts", href: `/orders/${id}#order-progress`, reason: "Material has been delivered. Invoices, receipts and credits determine the remaining balance." };
    return { label: orderProductionStages.includes(record.status) ? "Review production progress" : "Review production and delivery evidence", href: `/orders/${id}#order-progress`, reason: "Department prerequisites, quality holds and the confirmed transaction history determine the next operation." };
  }
  if (record.kind === "production") {
    if (!can(role, "read", "production")) return null;
    if (["completed", "cancelled"].includes(record.status)) return { label: "Review production outcome", reason: "This job is final. Corrections must follow the recorded production correction workflow." };
    return { label: record.status === "on_hold" ? "Review hold and resume conditions" : "Review start and completion conditions", href: `/production/${id}#production-readiness`, reason: "Current die, billet, machine, competency and customer requirements are rechecked by the transition." };
  }
  if (record.kind === "dispatch") {
    if (!can(role, "read", "dispatches")) return null;
    return record.status === "pending" && can(role, "update", "dispatches")
      ? { label: "Review dispatch details", href: `/dispatches/${id}/edit`, reason: "Committed material and changed quantities are revalidated when dispatch details are saved." }
      : { label: "Review delivery and return history", href: `/dispatches/${id}#delivery-history`, reason: "Use the delivery controls and recorded corrections for this shipment." };
  }
  if (record.kind === "quality") {
    if (!can(role, "read", "quality")) return null;
    if (record.status === "pending") return { label: can(role, "update", "quality") ? "Record observations against the inspection plan" : "Review inspection evidence", href: `/quality/${id}#inspection-results`, reason: "The applicable approved plan supplies the limits. Record actual observations; approval remains a separate guarded action." };
    return { label: "Review the inspection decision", href: `/quality/${id}`, reason: "This inspection has a recorded decision. Use its permitted correction or rework workflow instead of changing historical observations." };
  }
  if (record.kind === "packaging") {
    if (!can(role, "read", "packaging")) return null;
    if (["scheduled", "in_progress"].includes(record.status) && can(role, "update", "packaging")) return { label: "Review packing quantities and issued materials", href: `/packaging/${id}/edit`, reason: "Accepted source output and issued materials must reconcile before completion. Opening this form does not issue stock." };
    return { label: "Review packaging evidence", href: `/packaging/${id}`, reason: "Review the recorded quantities, material issues and completion state before preparing a dispatch." };
  }
  if (!can(role, "read", "financials")) return null;
  if (record.status === "draft" && can(role, "update", "financials")) return { label: "Review invoice before issue", href: `/invoices/${id}/edit`, reason: "Dispatch eligibility, commercial snapshots and duplicate billing are checked by invoice confirmation." };
  return { label: "Review receipts and credits", href: `/invoices/${id}#receipt-history`, reason: "Receipts, refunds and issued credits determine the balance. Record a receipt through the invoice payment controls." };
}
