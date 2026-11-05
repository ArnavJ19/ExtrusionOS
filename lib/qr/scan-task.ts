// NOV-017: what a scanned record means for the employee holding it. Warnings name held, inactive or
// consumed material; actions are links into the existing task screens, which recheck authority and
// current status before any change. A copied label is not proof of physical custody.

export type ScanWarning = { tone: "warning" | "critical"; text: string };
export type ScanAction = { label: string; href: string };
export type ScanTask = "stock_checked" | "die_checked" | "loaded_for_dispatch";
export type ScanPermissions = { read: (resource: string) => boolean; create: (resource: string) => boolean; readDieHistory: boolean; splitBundles: boolean };

const text = (row: Record<string, unknown>, key: string) => (typeof row[key] === "string" ? String(row[key]) : "");
const words = (value: string) => value.replace(/_/g, " ");
const id = (row: Record<string, unknown>) => encodeURIComponent(String(row.id ?? ""));

export function scanWarnings(entityType: string, row: Record<string, unknown>): ScanWarning[] {
  const warnings: ScanWarning[] = [];
  if (entityType === "inventory_batch") {
    const status = text(row, "status");
    if (["dispatched", "transformed", "scrap", "rejected"].includes(status)) warnings.push({ tone: "critical", text: `This bundle is ${words(status)} and is no longer available stock.` });
    if (status === "reserved") warnings.push({ tone: "warning", text: "This bundle is reserved for an order." });
    if (status === "in_transit") warnings.push({ tone: "critical", text: "This bundle is in transit on a warehouse transfer. Receive it on the transfer before using it." });
    if (text(row, "qc_status") === "on_hold") warnings.push({ tone: "critical", text: "This bundle is on QC hold. Do not load or use it until quality releases it." });
    if (text(row, "qc_status") === "rejected") warnings.push({ tone: "critical", text: "Quality rejected this bundle." });
  }
  if (entityType === "die" && !["active", "approved"].includes(text(row, "die_status"))) warnings.push({ tone: "critical", text: `Die is ${words(text(row, "die_status") || "not set")}; it cannot be planned for production.` });
  if (entityType === "production_job" && ["on_hold", "cancelled", "completed"].includes(text(row, "status"))) warnings.push({ tone: text(row, "status") === "completed" ? "warning" : "critical", text: `Job is ${words(text(row, "status"))}.` });
  if (entityType === "billet_batch" && ["consumed", "scrap", "cancelled", "rejected"].includes(text(row, "status"))) warnings.push({ tone: "critical", text: `Billet batch is ${words(text(row, "status"))}.` });
  if (entityType === "order" && ["cancelled", "closed", "delivered"].includes(text(row, "current_stage"))) warnings.push({ tone: "warning", text: `Order is ${words(text(row, "current_stage"))}.` });
  if (entityType === "machine" && ["breakdown", "maintenance", "inactive", "under_maintenance"].includes(text(row, "status"))) warnings.push({ tone: "critical", text: `Machine is ${words(text(row, "status"))}.` });
  if (entityType === "inventory_item" && Number(row.current_stock ?? 0) <= 0) warnings.push({ tone: "warning", text: "No stock is recorded for this item." });
  if (entityType === "dispatch_package") warnings.push({ tone: "warning", text: "This bundle is already on a dispatch manifest." });
  return warnings;
}

export function scanActions(entityType: string, row: Record<string, unknown>, can: ScanPermissions): ScanAction[] {
  const actions: ScanAction[] = [];
  const add = (condition: boolean, label: string, href: string) => { if (condition) actions.push({ label, href }); };
  switch (entityType) {
    case "die":
      add(can.readDieHistory, "Die operating history", `/tasks/improvement/dies/${id(row)}`);
      add(can.read("dies"), "Open die record", `/dies/${id(row)}`);
      break;
    case "inventory_batch":
      add(can.splitBundles && text(row, "status") === "available" && text(row, "qc_status") !== "on_hold", "Split or combine this bundle", "/tasks/lifecycle/new?action=bundle.split");
      add(can.read("inventory"), "Stock balances", "/inventory/stock-balances");
      break;
    case "production_job":
      add(can.read("production"), "Open job", `/production/${id(row)}`);
      add(can.create("production") && text(row, "status") === "in_progress", "Record output", `/production/${id(row)}/edit`);
      break;
    case "order":
      add(can.read("orders"), "Open order", `/orders/${id(row)}`);
      add(can.create("dispatches") && !["cancelled", "closed", "delivered"].includes(text(row, "current_stage")), "Prepare a dispatch", `/dispatches/new?order_id=${id(row)}`);
      break;
    case "dispatch": add(can.read("dispatches"), "Open dispatch", `/dispatches/${id(row)}`); break;
    case "quote": add(can.read("quotes"), "Open quotation", `/quotes/${id(row)}`); break;
    case "profile": add(can.read("profiles"), "Open profile", `/profiles/${id(row)}`); break;
    case "machine": add(can.read("production"), "Open machine", `/machines/${id(row)}`); break;
    case "inventory_item": add(can.read("inventory"), "Open inventory item", `/inventory/${id(row)}`); break;
  }
  return actions;
}

/** Which bounded scan sessions accept which records. */
export const SCAN_TASKS: Record<ScanTask, { label: string; accepts: readonly string[] }> = {
  stock_checked: { label: "Stock check", accepts: ["inventory_batch", "inventory_item", "billet_batch"] },
  die_checked: { label: "Die check", accepts: ["die"] },
  loaded_for_dispatch: { label: "Dispatch loading check", accepts: ["inventory_batch", "dispatch_package"] }
};
