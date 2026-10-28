import { can } from "../auth/permissions.ts";
import type { UserRole } from "../../types/app.ts";

export type NextActionRecord = { kind: "quote" | "order" | "production" | "dispatch" | "invoice"; id: string; status: string; linkedOrderId?: string | null; completeCosting?: boolean };
export type NextRecordAction = { label: string; href?: string; reason: string };
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function nextRecordAction(role: UserRole, record: NextActionRecord, dealerId?: string | null): NextRecordAction | null {
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
    if (can(role, "create", "dispatches")) return { label: "Review available material for dispatch", href: `/dispatches/new?order_id=${id}`, reason: "The order is preselected. Packing, source eligibility and remaining quantities are checked before posting." };
    return { label: "Review production and delivery evidence", href: `/orders/${id}#order-progress`, reason: "Department prerequisites, quality holds and the confirmed transaction history determine the next operation." };
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
  if (!can(role, "read", "financials")) return null;
  if (record.status === "draft" && can(role, "update", "financials")) return { label: "Review invoice before issue", href: `/invoices/${id}/edit`, reason: "Dispatch eligibility, commercial snapshots and duplicate billing are checked by invoice confirmation." };
  return { label: "Review receipts and credits", href: `/invoices/${id}#receipt-history`, reason: "Receipts, refunds and issued credits determine the balance. Record a receipt through the invoice payment controls." };
}
