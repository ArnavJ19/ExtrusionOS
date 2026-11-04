// NOV-009: start a new record from a previous one. Each family copies only its reviewed setup
// fields, refreshes dated terms, clears transaction identity and never copies physical
// observations, posted quantities, approvals or payments. The new record gets its own identity
// and is saved through its existing action; the source is never changed.

export type RepeatFamily = "production_jobs" | "dispatches" | "packaging_material_purchases";

type Rule = { label: string; copy: readonly string[]; refreshed: readonly string[]; cleared: readonly string[] };
export const REPEAT_RULES: Record<RepeatFamily, Rule> = {
  production_jobs: { label: "production job", copy: ["machine_id", "shift", "extrusion_efficiency_percent"], refreshed: ["planned_date"],
    cleared: ["job_number", "order_id", "source_line_id", "profile_id", "die_id", "planned_quantity_kg", "pieces", "required_billet_count", "length_per_piece_m", "operator_name", "status", "remarks"] },
  dispatches: { label: "dispatch", copy: ["order_id", "transporter_name", "vehicle_number", "driver_name", "driver_phone"], refreshed: ["dispatch_date"],
    cleared: ["dispatch_number", "bundles", "eway_bill_number", "lr_number", "remarks", "proof_of_delivery_url", "packing_list_url"] },
  packaging_material_purchases: { label: "purchase receipt", copy: ["material_id", "vendor_id", "unit", "rate", "payment_method"], refreshed: ["received_date"],
    cleared: ["purchase_number", "quantity", "base_amount", "tax_amount", "freight_amount", "discount_amount", "total_amount", "invoice_number", "invoice_date", "due_date", "payment_status", "notes"] }
};

export function repeatFamilyFor(moduleKey: string): RepeatFamily | null {
  return moduleKey === "production" ? "production_jobs" : moduleKey === "dispatches" ? "dispatches" : moduleKey === "packaging_material_purchases" ? "packaging_material_purchases" : null;
}

/** Current state of the masters a copied value refers to, re-read under the user's company scope. */
export type RepeatChecks = {
  today: string;
  machineUsable?: boolean;
  orderStage?: string | null;
  materialActive?: boolean;
  vendorActive?: boolean;
};

export type RepeatDraft = { values: Record<string, string>; copied: string[]; refreshed: Record<string, string>; warnings: string[] };

const closedOrderStages = ["delivered", "cancelled", "closed"];
const present = (value: unknown) => value !== null && value !== undefined && String(value).trim() !== "";

/** Builds the unsaved draft. A copied reference that is no longer usable is dropped with a warning, never kept silently. */
export function buildRepeatDraft(family: RepeatFamily, source: Record<string, unknown>, checks: RepeatChecks): RepeatDraft {
  const rule = REPEAT_RULES[family];
  const values: Record<string, string> = {};
  const warnings: string[] = [];
  for (const key of rule.copy) if (present(source[key])) values[key] = String(source[key]).trim();
  if (family === "production_jobs" && values.machine_id && checks.machineUsable === false) {
    delete values.machine_id; warnings.push("The press used last time is not an active extrusion press now. Choose a current press.");
  }
  if (family === "dispatches") {
    if (values.order_id && (checks.orderStage === null || checks.orderStage === undefined || closedOrderStages.includes(checks.orderStage))) {
      delete values.order_id; warnings.push(checks.orderStage ? `The previous order is ${checks.orderStage.replace(/_/g, " ")}. Choose the order for this load.` : "The previous order is no longer available. Choose the order for this load.");
    }
    if (values.vehicle_number || values.driver_name || values.driver_phone) warnings.push("Confirm the vehicle and driver are the same for this load.");
  }
  if (family === "packaging_material_purchases") {
    if (values.material_id && checks.materialActive === false) { delete values.material_id; warnings.push("The previous material is inactive. Choose a current material."); }
    if (values.vendor_id && checks.vendorActive === false) { delete values.vendor_id; warnings.push("The previous vendor is inactive. Choose a current vendor."); }
    if (values.rate) {
      const date = typeof source.received_date === "string" ? source.received_date : null;
      warnings.push(`The rate ${values.rate} is from the previous receipt${date ? ` on ${date}` : ""}. Confirm the current rate before saving.`);
    }
  }
  const refreshed = Object.fromEntries(rule.refreshed.map(key => [key, checks.today]));
  return { values, copied: Object.keys(values), refreshed, warnings };
}

/** Fields that may be recorded as copied in the lineage link; mirrors public.record_repeat_link. */
export function repeatLineageFields(family: RepeatFamily, copied: readonly string[], finalValues: Record<string, unknown>, draft: Record<string, string>) {
  // Only values the employee kept are recorded as repeated.
  return copied.filter(key => REPEAT_RULES[family].copy.includes(key) && String(finalValues[key] ?? "") === draft[key]);
}
