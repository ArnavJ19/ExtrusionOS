export type StatusFamily = "neutral" | "active" | "waiting" | "blocked" | "completed";

const families: Record<StatusFamily, readonly string[]> = {
  neutral: ["draft", "inactive", "low", "normal", "info", "cancelled", "archived", "retired", "scrapped", "superseded", "not_required", "idle", "design"],
  active: ["active", "available", "operational", "trial", "under_trial", "nitriding", "in_progress", "in_process", "running", "melting", "homogenizing", "billet_heating", "extruded", "stretching", "cutting", "aging", "surface_treatment", "finishing", "packing", "dispatched", "in_transit", "sent_to_vendor", "in_production"],
  waiting: ["pending", "planned", "scheduled", "queued", "open", "ready", "received", "ordered", "submitted", "internal_review", "approved_for_sending", "sent", "payment_pending", "partially_paid", "reserved", "low_stock", "medium", "high", "warning", "order_confirmed", "die_ready", "billet_ready", "extrusion_planned", "partially_allocated"],
  blocked: ["blocked", "on_hold", "quality_hold", "rejected", "customer_rejected", "rework", "under_correction", "correction", "under_maintenance", "maintenance", "breakdown", "dead", "failed", "urgent", "critical", "delayed", "overdue", "out_of_stock", "damaged", "returned", "expired", "shortage", "unallocated"],
  completed: ["approved", "customer_approved", "completed", "closed", "paid", "credited", "delivered", "converted_to_order", "cast", "issued", "consumed", "allocated", "fully_allocated", "generated", "success"]
};

export const statusTokens: Record<StatusFamily, { className: string; label: string }> = {
  neutral: { className: "border-neutral-300 bg-neutral-100 text-neutral-700", label: "Reference" },
  active: { className: "border-sky-300 bg-sky-50 text-sky-800", label: "Active" },
  waiting: { className: "border-amber-300 bg-amber-50 text-amber-900", label: "Waiting" },
  blocked: { className: "border-red-300 bg-red-50 text-red-800", label: "Needs attention" },
  completed: { className: "border-emerald-300 bg-emerald-50 text-emerald-800", label: "Completed" }
};

const statusFamilies = new Map(Object.entries(families).flatMap(([family, codes]) => codes.map((code) => [code, family as StatusFamily] as const)));

/** Presentation only. This must never be used to authorize a transition. */
export function getStatusPresentation(code: string) {
  const normalized = code.trim().toLowerCase();
  const family = statusFamilies.get(normalized) ?? "neutral";
  const label = (code.trim() || "Unknown status").replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
  return { code, family, className: statusTokens[family].className, familyLabel: statusTokens[family].label, label, labelText: label };
}
