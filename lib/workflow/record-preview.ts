import type { ModuleKey } from "@/components/modules/operations/module-config";

export type PreviewValue = string | number | boolean;
export type PreviewField = { label: string; value: PreviewValue };
export type RecordPreviewModel = { title: string; subtitle: string | null; fields: PreviewField[] };

export function recordPreviewScope(context: { companyId: string; userId: string; role: string }): string {
  return JSON.stringify([context.companyId, context.userId, context.role]);
}

type ModulePreviewSpec = { identifiers: string[]; fields: [string, string][]; required?: string[]; contacts?: [string, string][] };

const specs: Partial<Record<ModuleKey, ModulePreviewSpec>> = {
  orders: { identifiers: ["order_number"], fields: [["current_stage", "Current stage"], ["priority", "Priority"], ["order_date", "Order date"], ["expected_dispatch_date", "Expected dispatch"], ["billets_required", "Billets required"], ["billets_allocated", "Allocated"]], required: ["billets_required"] },
  quotes: { identifiers: ["quote_number"], fields: [["status", "Status"], ["valid_until", "Valid until"], ["created_at", "Created"]] },
  dispatches: { identifiers: ["dispatch_number"], fields: [["delivery_status", "Delivery status"], ["dispatch_date", "Dispatch date"], ["transporter_name", "Transporter"], ["vehicle_number", "Vehicle"], ["total_weight_kg", "Weight (kg)"]], required: ["total_weight_kg"], contacts: [["driver_name", "Driver"], ["driver_phone", "Driver phone"]] },
  production: { identifiers: ["job_number"], fields: [["status", "Status"], ["planned_date", "Planned date"], ["planned_quantity_kg", "Planned quantity (kg)"], ["pieces", "Pieces"], ["machine.machine_name", "Machine"], ["profile.profile_code", "Profile"], ["die.die_number", "Die"], ["order.order_number", "Order"]], required: ["planned_quantity_kg"] },
  packaging: { identifiers: ["packaging_number"], fields: [["status", "Status"], ["orders.order_number", "Order"], ["pieces", "Pieces"], ["profile_weight_kg", "Weight (kg)"]], required: ["pieces"] },
  foundry: { identifiers: ["batch_number"], fields: [["status", "Status"], ["production_date", "Production date"], ["alloy", "Alloy"], ["temper", "Temper"], ["billet_count", "Billets"], ["required_furnace_charge_kg", "Furnace charge (kg)"], ["total_billet_weight_density_kg", "Billet weight (kg)"]], required: ["billet_count"] },
  foundry_billets: { identifiers: ["billet_code"], fields: [["status", "Status"], ["source_type", "Source"], ["alloy", "Alloy"], ["billet_diameter_inch", "Diameter (in)"], ["weight_kg", "Weight (kg)"], ["orders.order_number", "Order"]], required: ["weight_kg"] },
  foundry_external_sources: { identifiers: ["source_number"], fields: [["item_type", "Material"], ["alloy", "Alloy"], ["weight_kg", "Weight (kg)"], ["quantity", "Quantity"], ["status", "Status"]], required: ["weight_kg"], contacts: [["vendors.vendor_name", "Vendor"], ["vendors.phone", "Vendor phone"]] },
  foundry_scrap: { identifiers: ["scrap_number"], fields: [["status", "Status"], ["scrap_source", "Source"], ["scrap_quality", "Quality"], ["weight_kg", "Weight (kg)"], ["available_weight_kg", "Available (kg)"], ["vendors.vendor_name", "Vendor"]], required: ["weight_kg"] },
  outsourced_billets: { identifiers: ["batch_number"], fields: [["status", "Status"], ["alloy", "Alloy"], ["billet_diameter_inch", "Diameter (in)"], ["weight_kg", "Weight (kg)"], ["vendors.vendor_name", "Vendor"]], required: ["weight_kg"], contacts: [["vendors.phone", "Vendor phone"]] },
  inventory: { identifiers: ["item_code", "item_name"], fields: [["item_category", "Category"], ["current_stock", "Stock"], ["unit", "Unit"], ["reorder_level", "Reorder level"], ["location", "Location"]], required: ["current_stock"] },
  customers: { identifiers: ["company_name", "customer_name"], fields: [["customer_type", "Customer type"], ["city", "City"], ["state", "State"], ["status", "Status"]], contacts: [["contact_person", "Contact"], ["phone", "Phone"], ["email", "Email"]] },
  profiles: { identifiers: ["profile_code", "profile_name"], fields: [["application_category", "Application"], ["alloy", "Alloy"], ["temper", "Temper"], ["section_weight_kg_per_m", "Section weight (kg/m)"]], required: ["section_weight_kg_per_m"] },
  quality: { identifiers: ["batch_number"], fields: [["status", "Inspection result"], ["inspection_date", "Inspection date"], ["quantity_checked_kg", "Quantity checked (kg)"], ["inspector_name", "Inspector"], ["production_jobs.job_number", "Production job"], ["aluminium_profiles.profile_code", "Profile"]], required: ["quantity_checked_kg"] },
  invoices: { identifiers: ["invoice_number"], fields: [["status", "Status"], ["invoice_date", "Invoice date"], ["due_date", "Due date"]] },
  vendors: { identifiers: ["vendor_name"], fields: [["vendor_type", "Vendor type"], ["city", "City"], ["status", "Status"]], contacts: [["contact_person", "Contact"], ["phone", "Phone"], ["email", "Email"]] },
  tasks: { identifiers: ["title", "task_number"], fields: [["status", "Status"], ["priority", "Priority"], ["due_date", "Due date"], ["assigned_to_name", "Assigned to"]] },
  payments: { identifiers: ["reference_number", "payment_method"], fields: [["payment_status", "Status"], ["payment_date", "Payment date"], ["payment_method", "Method"], ["payment_type", "Type"]] },
  expenses: { identifiers: ["expense_number"], fields: [["approval_status", "Approval status"], ["payment_status", "Payment status"], ["expense_category", "Category"], ["created_at", "Date"], ["source_module", "Source module"], ["vendors.vendor_name", "Vendor"]] },
  expense_payments: { identifiers: ["expense_ledger.expense_number", "reference_number"], fields: [["status", "Status"], ["payment_date", "Payment date"], ["payment_method", "Method"], ["reference_number", "Reference"]] },
  machines: { identifiers: ["machine_name"], fields: [["machine_code", "Machine code"], ["machine_type", "Machine type"], ["status", "Status"], ["manufacturer", "Manufacturer"]] },
  packaging_materials: { identifiers: ["material_code"], fields: [["material_name", "Material"], ["material_type", "Material type"], ["current_stock", "Stock"], ["reorder_level", "Reorder level"], ["vendors.vendor_name", "Vendor"]], required: ["current_stock"] },
  packaging_material_purchases: { identifiers: ["purchase_number"], fields: [["payment_status", "Payment status"], ["purchase_date", "Purchase date"], ["packaging_materials.material_name", "Material"], ["quantity", "Quantity"], ["vendors.vendor_name", "Vendor"]], required: ["quantity"] },
  packaging_job_materials: { identifiers: ["packaging_materials.material_code", "packaging_materials.material_name", "packaging_jobs.packaging_number"], fields: [["packaging_jobs.packaging_number", "Packaging job"], ["packaging_materials.material_name", "Material"], ["quantity_required", "Quantity required"]], required: ["quantity_required"] }
};

function scalarAt(row: Record<string, unknown>, path: string): PreviewValue | null {
  let value: unknown = row;
  for (const part of path.split(".")) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    value = (value as Record<string, unknown>)[part];
  }
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : null;
}

function present(value: PreviewValue): boolean {
  return typeof value === "string" ? value.trim().length > 0 : true;
}

export function buildRecordPreviewModel(moduleKey: ModuleKey, row: Record<string, unknown> | null | undefined): RecordPreviewModel | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const spec = specs[moduleKey];
  if (!spec) return null;
  const titleField = spec.identifiers.map((path) => scalarAt(row, path)).find((value): value is PreviewValue => value !== null && present(value));
  const title = titleField === undefined ? "Record" : String(titleField);
  const subtitle = scalarAt(row, "customers.company_name") ?? scalarAt(row, "company_name");
  const fields = [...spec.fields, ...(spec.contacts ?? [])]
    .map(([path, label]) => {
      const value = scalarAt(row, path);
      if (value === null || !present(value)) return spec.required?.includes(path) ? { label, value: "Not recorded" } : null;
      return { label, value };
    })
    .filter((field): field is PreviewField => field !== null);
  return { title, subtitle: subtitle === null || !present(subtitle) ? null : String(subtitle), fields };
}

export function buildRecordDetailHref(basePath: string, returnTo: string, recordId: unknown): string | null {
  if (typeof recordId !== "string" || !recordId || recordId.length > 200 || /[\u0000-\u001f\\]/.test(recordId)) return null;
  const expectedPath = `${basePath.replace(/\/$/, "")}/database`;
  if (typeof returnTo !== "string" || returnTo.length > 2048 || !returnTo.startsWith("/") || returnTo.startsWith("//")) return null;
  const queryStart = returnTo.indexOf("?");
  const path = queryStart < 0 ? returnTo : returnTo.slice(0, queryStart);
  if (path !== expectedPath || returnTo.includes("#") || /[\u0000-\u001f\\]/.test(returnTo)) return null;
  const params = new URLSearchParams();
  params.set("returnTo", returnTo);
  return `${basePath.replace(/\/$/, "")}/${encodeURIComponent(recordId)}?${params.toString()}`;
}
