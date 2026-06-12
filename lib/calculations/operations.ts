export type OperationalRisk = {
  label: string;
  severity: "critical" | "warning" | "info";
  detail: string;
};

const closedOrderStages = new Set(["dispatched", "delivered", "closed", "cancelled"]);
const closedInvoiceStatuses = new Set(["paid", "cancelled"]);

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(from?: string | null, to = todayIso()) {
  if (!from) return null;
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.floor((end - start) / 86400000);
}

export function getOperationalRisks(moduleKey: string, row: Record<string, any>, today = todayIso()): OperationalRisk[] {
  const risks: OperationalRisk[] = [];

  if (moduleKey === "orders") {
    if (row.expected_dispatch_date && row.expected_dispatch_date < today && !closedOrderStages.has(row.current_stage)) {
      risks.push({ label: "Delayed Dispatch", severity: "critical", detail: "Expected dispatch date has passed before delivery/closure." });
    }
    if (["urgent", "high"].includes(row.priority) && !closedOrderStages.has(row.current_stage)) {
      risks.push({ label: "Priority Order", severity: row.priority === "urgent" ? "critical" : "warning", detail: "Keep material reservation, production, finishing, and dispatch visible." });
    }
  }

  if (moduleKey === "quotes") {
    if (row.low_margin_approval_required) risks.push({ label: "Low Margin", severity: "warning", detail: "Owner/admin approval is required before this quote is sent." });
    if (row.valid_until && row.valid_until < today && !["converted_to_order", "customer_rejected", "expired"].includes(row.status)) {
      risks.push({ label: "Expired", severity: "warning", detail: "Quote validity has passed and should be revised or expired." });
    }
  }

  if (moduleKey === "inventory") {
    const stock = Number(row.current_stock ?? 0);
    const reorder = Number(row.reorder_level ?? 0);
    if (stock < 0) risks.push({ label: "Negative Stock", severity: "critical", detail: "Stock is below zero. Check movements before new dispatch or production issue." });
    else if (stock === 0) risks.push({ label: "Out Of Stock", severity: "critical", detail: "No available stock is recorded for this item." });
    else if (reorder > 0 && stock <= reorder) risks.push({ label: "Reorder Due", severity: "warning", detail: "Current stock is at or below the reorder level." });
  }

  if (moduleKey === "production") {
    const planned = Number(row.planned_quantity_kg ?? 0);
    const actual = Number(row.actual_quantity_kg ?? 0);
    if (!row.die_id) risks.push({ label: "Die Missing", severity: "critical", detail: "Production job should not run without a linked die." });
    if (row.status === "completed" && planned > 0 && actual > 0 && actual < planned * 0.9) {
      risks.push({ label: "Low Output", severity: "warning", detail: "Actual output is below 90% of planned kg." });
    }
    if (row.planned_date && row.planned_date < today && !["completed", "cancelled"].includes(row.status)) {
      risks.push({ label: "Plan Slipped", severity: "warning", detail: "Planned production date has passed and job is still open." });
    }
  }

  if (moduleKey === "quality") {
    if (["rejected", "rework"].includes(row.status)) risks.push({ label: "Quality Hold", severity: "critical", detail: "Batch needs rework, deviation approval, or rejection handling." });
    if (row.surface_finish_ok === false) risks.push({ label: "Surface Defect", severity: "warning", detail: "Surface finish failed inspection." });
  }

  if (moduleKey === "invoices") {
    if (row.due_date && row.due_date < today && Number(row.balance_due ?? 0) > 0 && !closedInvoiceStatuses.has(row.status)) {
      risks.push({ label: "Overdue", severity: "critical", detail: "Payment is overdue and should be followed up." });
    }
  }

  if (moduleKey === "dispatches" && ["delayed", "damaged", "returned"].includes(row.delivery_status)) {
    risks.push({ label: "Delivery Exception", severity: "critical", detail: "Dispatch needs logistics or customer follow-up." });
  }

  if (moduleKey === "profiles") {
    if (!Number(row.section_weight_kg_per_m)) risks.push({ label: "Missing Kg/M", severity: "critical", detail: "Add section weight before quotation, BOM, or production planning." });
    if (!row.standard_length_m) risks.push({ label: "Length Missing", severity: "warning", detail: "Standard length improves BOM, stock, and cutting-list accuracy." });
  }

  if (moduleKey === "customers") {
    if (!row.phone && !row.whatsapp_number && !row.email) risks.push({ label: "No Contact", severity: "warning", detail: "Add phone, WhatsApp, or email for follow-up and dispatch coordination." });
    if (!row.gst_number && ["dealer", "fabricator", "contractor", "industrial"].includes(row.customer_type)) risks.push({ label: "GST Missing", severity: "info", detail: "GST details improve invoice readiness." });
  }

  if (moduleKey === "vendors") {
    if (!row.phone && !row.email) risks.push({ label: "No Contact", severity: "warning", detail: "Add supplier contact details for procurement and service follow-up." });
  }

  return risks;
}

export function getDieRisks(row: Record<string, any>, today = todayIso()): OperationalRisk[] {
  const risks: OperationalRisk[] = [];
  const idleDays = daysBetween(row.last_used_date, today);
  if (["correction", "dead"].includes(row.die_status)) risks.push({ label: "Unavailable", severity: "critical", detail: "Die should not be selected for production until status is resolved." });
  if (row.die_status === "nitriding") risks.push({ label: "Maintenance", severity: "warning", detail: "Die is away or under surface treatment." });
  if (idleDays !== null && idleDays > 180 && row.die_status === "active") risks.push({ label: "Idle 180+ Days", severity: "info", detail: "Review die demand, customer ownership, and rack location." });
  if (Number(row.total_production_kg ?? 0) > 25000) risks.push({ label: "Life Review", severity: "warning", detail: "High cumulative production. Inspect bearing, die lines, and correction history." });
  return risks;
}

export function calculateProductionYield(plannedKg: unknown, actualKg: unknown) {
  const planned = Number(plannedKg ?? 0);
  const actual = Number(actualKg ?? 0);
  if (planned <= 0) return null;
  return Math.round((actual / planned) * 1000) / 10;
}
