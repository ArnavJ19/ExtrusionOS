import type { ZodSchema } from "zod";
import { aluminiumScrapSchema, customerSchema, dispatchSchema, expenseLedgerSchema, expensePaymentSchema, externalAluminiumSourceSchema, foundryBatchSchema, inventoryItemSchema, invoiceSchema, orderSchema, packagingJobSchema, packagingMaterialSchema, packagingMaterialPurchaseSchema, packagingJobMaterialSchema, productionJobSchema, profileSchema, qualityInspectionSchema, vendorSchema, machineSchema } from "@/lib/validations/schemas";
import { aluminiumScrapQualities, applicationCategories, customerTypes, deliveryStatuses, externalAluminiumSourceTypes, foundryBatchStatuses, inventoryCategories, invoiceStatuses, orderPriorities, orderStages, packagingCalculationMethods, packagingJobStatuses, packagingMaterialTypes, productionJobStatuses, qualityStatuses, quoteStatuses, standardAlloys, standardTempers, vendorTypes } from "@/types/app";
import type { Resource } from "@/lib/auth/permissions";

export type ModuleKey = "orders" | "quotes" | "dispatches" | "production" | "foundry" | "foundry_external_sources" | "foundry_scrap" | "foundry_billets" | "outsourced_billets" | "packaging" | "packaging_materials" | "packaging_material_purchases" | "packaging_job_materials" | "inventory" | "customers" | "profiles" | "quality" | "invoices" | "vendors" | "tasks" | "payments" | "expenses" | "expense_payments" | "machines";

export type FieldConfig = {
  name: string;
  label: string;
  type?: "text" | "number" | "date" | "textarea" | "select" | "checkbox";
  required?: boolean;
  options?: { value: string; label: string }[];
  lookup?: { table: string; select: string; labelFields: string[]; orderBy: string; filter?: Record<string, string | boolean> };
  step?: string;
  placeholder?: string;
  readOnly?: boolean;
};

export type ColumnConfig = {
  id: string;
  header: string;
  path: string;
  type?: "text" | "badge" | "date" | "currency" | "weight" | "number";
  sortable?: boolean;
};

export type ModuleConfig = {
  key: ModuleKey;
  title: string;
  databaseTitle: string;
  description: string;
  table: string;
  select: string;
  basePath: string;
  resource: Resource;
  primaryAction: string;
  databaseAction: string;
  groupField?: string;
  groups?: string[];
  searchPlaceholder: string;
  searchFields: string[];
  customerIdField?: string;
  profileIdField?: string;
  orderIdField?: string;
  dateFilterField?: string;
  secondaryFilter?: { field: string; label: string; options: { value: string; label: string }[] };
  defaultSort: { column: string; direction: "asc" | "desc" };
  columns: ColumnConfig[];
  card: { titlePath: string; subtitlePath?: string; badgePath?: string; meta: { label: string; path: string; type?: ColumnConfig["type"] }[] };
  schema?: ZodSchema<any>;
  defaultValues?: Record<string, any>;
  fields?: FieldConfig[];
  numberPrefix?: string;
  numberField?: string;
  generateNumber?: (payload: any, existingNumbers: string[]) => string;
  uniqueField?: string;
  uniqueLabel?: string;
  emptyState?: { title: string; description: string };
  detailIntro?: string;
  detailSections?: { title: string; fields: { label: string; path: string; type?: ColumnConfig["type"] }[] }[];
  relatedRecords?: { label: string; table: string; field: string; href: string; hint: string }[];
};

function options(values: string[]) {
  return values.map((value) => ({ value, label: value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()) }));
}

const customerLookup = { table: "customers", select: "id, customer_name, company_name", labelFields: ["company_name", "customer_name"], orderBy: "customer_name" };
const profileLookup = { table: "aluminium_profiles", select: "id, profile_code, profile_name, alloy, temper, billet_diameter_required_inch", labelFields: ["profile_code", "profile_name"], orderBy: "profile_code" };
const orderLookup = { table: "orders", select: "id, order_number, priority, billets_required, billets_allocated, billets_short, billet_allocation_status, billet_diameter_required_inch", labelFields: ["order_number"], orderBy: "order_date" };
const vendorLookup = { table: "vendors", select: "id, vendor_name, vendor_type, phone", labelFields: ["vendor_name", "vendor_type"], orderBy: "vendor_name" };
const scrapLookup = { table: "foundry_aluminium_scrap", select: "id, scrap_number, scrap_quality, available_weight_kg, weight_kg, status", labelFields: ["scrap_number", "scrap_quality"], orderBy: "scrap_number", filter: { status: "available" } };
const externalSourceLookup = { table: "foundry_external_aluminium_sources", select: "id, source_number, item_type, alloy, available_weight_kg, weight_kg, status", labelFields: ["source_number", "item_type", "alloy"], orderBy: "source_number", filter: { status: "available" } };

export const moduleConfigs: Record<ModuleKey, ModuleConfig> = {
  orders: {
    key: "orders",
    title: "Orders",
    databaseTitle: "Orders Database",
    description: "Track customer orders by production stage, priority, expected dispatch, and value.",
    table: "orders",
    select: "*, customers(customer_name, company_name), quotes(quote_number), production_profile:aluminium_profiles!orders_production_profile_id_fkey(profile_code, profile_name, billet_diameter_required_inch), production_die:dies!orders_production_die_id_fkey(die_number, billet_diameter_required_inch)",
    basePath: "/orders",
    resource: "orders",
    primaryAction: "Create Order",
    databaseAction: "View Orders Database",
    groupField: "current_stage",
    groups: orderStages,
    searchPlaceholder: "Search order number, customer, stage, priority...",
    searchFields: ["order_number", "current_stage", "priority", "notes"],
    customerIdField: "customer_id",
    dateFilterField: "expected_dispatch_date",
    secondaryFilter: { field: "priority", label: "Priority", options: options(orderPriorities) },
    defaultSort: { column: "expected_dispatch_date", direction: "asc" },
    columns: [
      { id: "order_number", header: "Order Number", path: "order_number", sortable: true },
      { id: "customer", header: "Customer", path: "customers.company_name" },
      { id: "order_origin", header: "Origin", path: "order_origin", type: "badge", sortable: true },
      { id: "order_source_label", header: "Source", path: "order_source_label", sortable: true },
      { id: "current_stage", header: "Stage", path: "current_stage", type: "badge", sortable: true },
      { id: "priority", header: "Priority", path: "priority", type: "badge", sortable: true },
      { id: "billets_required", header: "Billets Req", path: "billets_required", type: "number", sortable: true },
      { id: "billets_allocated", header: "Allocated", path: "billets_allocated", type: "number", sortable: true },
      { id: "billet_allocation_status", header: "Billet Status", path: "billet_allocation_status", type: "badge", sortable: true },
      { id: "order_date", header: "Order Date", path: "order_date", type: "date", sortable: true },
      { id: "expected_dispatch_date", header: "Expected Dispatch", path: "expected_dispatch_date", type: "date", sortable: true },
      { id: "order_value", header: "Order Value", path: "order_value", type: "currency", sortable: true }
    ],
    card: { titlePath: "order_number", subtitlePath: "customers.company_name", badgePath: "priority", meta: [{ label: "Expected", path: "expected_dispatch_date", type: "date" }, { label: "Billets", path: "billets_required", type: "number" }, { label: "Allocated", path: "billets_allocated", type: "number" }, { label: "Value", path: "order_value", type: "currency" }] },
    schema: orderSchema,
    numberPrefix: "O",
    numberField: "order_number",
    defaultValues: { customer_id: "", quote_id: "", production_profile_id: "", production_die_id: "", production_quantity_kg: 0, production_pieces: 0, billet_diameter_required_inch: "", order_date: new Date().toISOString().slice(0, 10), expected_dispatch_date: "", priority: "normal", current_stage: "order_confirmed", order_value: 0, production_notes: "", notes: "" },
    fields: [
      { name: "customer_id", label: "Customer", type: "select", required: true, readOnly: true, lookup: customerLookup },
      { name: "quote_id", label: "Approved quote", type: "select", readOnly: true, lookup: { table: "quotes", select: "id, quote_number", labelFields: ["quote_number"], orderBy: "quote_date" } },
      { name: "production_profile_id", label: "Production profile", type: "select", lookup: profileLookup },
      { name: "production_die_id", label: "Production die", type: "select", lookup: { table: "dies", select: "id, die_number, profile_id, die_status, billet_diameter_required_inch", labelFields: ["die_number"], orderBy: "die_number" } },
      { name: "production_quantity_kg", label: "Production qty kg", type: "number", step: "0.001" },
      { name: "production_pieces", label: "Production pieces", type: "number" },
      { name: "billet_diameter_required_inch", label: "Required billet diameter inch", type: "number", step: "0.01" },
      { name: "order_date", label: "Order date", type: "date", required: true, readOnly: true },
      { name: "expected_dispatch_date", label: "Expected dispatch", type: "date" },
      { name: "priority", label: "Priority", type: "select", options: options(orderPriorities) },
      { name: "order_value", label: "Order value", type: "number", readOnly: true },
      { name: "production_notes", label: "Production notes", type: "textarea" },
      { name: "notes", label: "Notes", type: "textarea" }
    ]
  },
  quotes: {
    key: "quotes",
    title: "Quotes",
    databaseTitle: "Quotes Database",
    description: "Track quotations by approval status, expiry risk, customer decision, and value.",
    table: "quotes",
    select: "*, customers(customer_name, company_name)",
    basePath: "/quotes",
    resource: "quotes",
    primaryAction: "Create Quote",
    databaseAction: "View Quote Database",
    groupField: "status",
    groups: quoteStatuses,
    searchPlaceholder: "Search quote number, customer, status...",
    searchFields: ["quote_number", "status", "notes"],
    customerIdField: "customer_id",
    dateFilterField: "quote_date",
    defaultSort: { column: "created_at", direction: "desc" },
    columns: [
      { id: "quote_number", header: "Quote Number", path: "quote_number", sortable: true },
      { id: "customer", header: "Customer", path: "customers.company_name" },
      { id: "status", header: "Status", path: "status", type: "badge", sortable: true },
      { id: "quote_date", header: "Quote Date", path: "quote_date", type: "date", sortable: true },
      { id: "valid_until", header: "Valid Until", path: "valid_until", type: "date", sortable: true },
      { id: "grand_total", header: "Total Value", path: "grand_total", type: "currency", sortable: true }
    ],
    card: { titlePath: "quote_number", subtitlePath: "customers.company_name", badgePath: "status", meta: [{ label: "Valid until", path: "valid_until", type: "date" }, { label: "Value", path: "grand_total", type: "currency" }] },
    fields: []
  },
  dispatches: {
    key: "dispatches",
    title: "Dispatches",
    databaseTitle: "Dispatch Database",
    description: "Track dispatches by delivery status, vehicle, transporter, e-way bill, and shipment weight.",
    table: "dispatches",
    select: "*, orders(order_number, customers(customer_name, company_name))",
    basePath: "/dispatches",
    resource: "dispatches",
    primaryAction: "Create Dispatch",
    databaseAction: "View Dispatch Database",
    groupField: "delivery_status",
    groups: deliveryStatuses,
    searchPlaceholder: "Search dispatch, order, transporter, vehicle, e-way bill...",
    searchFields: ["dispatch_number", "delivery_status", "transporter_name", "vehicle_number", "eway_bill_number", "lr_number"],
    orderIdField: "order_id",
    dateFilterField: "dispatch_date",
    defaultSort: { column: "dispatch_date", direction: "desc" },
    columns: [
      { id: "dispatch_number", header: "Dispatch Number", path: "dispatch_number", sortable: true },
      { id: "order", header: "Order", path: "orders.order_number" },
      { id: "customer", header: "Customer", path: "orders.customers.company_name" },
      { id: "delivery_status", header: "Status", path: "delivery_status", type: "badge", sortable: true },
      { id: "dispatch_date", header: "Dispatch Date", path: "dispatch_date", type: "date", sortable: true },
      { id: "vehicle_number", header: "Vehicle", path: "vehicle_number", sortable: true },
      { id: "transporter_name", header: "Transporter", path: "transporter_name", sortable: true },
      { id: "total_weight_kg", header: "Weight", path: "total_weight_kg", type: "weight", sortable: true }
    ],
    card: { titlePath: "dispatch_number", subtitlePath: "orders.order_number", badgePath: "delivery_status", meta: [{ label: "Vehicle", path: "vehicle_number" }, { label: "Weight", path: "total_weight_kg", type: "weight" }] },
    schema: dispatchSchema,
    numberPrefix: "D",
    numberField: "dispatch_number",
    defaultValues: { order_id: "", dispatch_date: new Date().toISOString().slice(0, 10), number_of_bundles: 1, total_weight_kg: 0, bundle_tare_weights_kg: "0", transporter_name: "", vehicle_number: "", driver_name: "", driver_phone: "", eway_bill_number: "", lr_number: "", delivery_status: "dispatched", proof_of_delivery_url: "", packing_list_url: "", remarks: "" },
    fields: [
      { name: "order_id", label: "Order", type: "select", required: true, lookup: orderLookup },
      { name: "dispatch_date", label: "Dispatch date", type: "date", required: true },
      { name: "number_of_bundles", label: "Physical bundles", type: "number", required: true, step: "1" },
      { name: "total_weight_kg", label: "Net aluminium weight kg", type: "number", required: true, step: "0.001" },
      { name: "bundle_tare_weights_kg", label: "Bundle tare kg (one per line)", type: "textarea", required: true, placeholder: "1.250\n1.180\n1.320" },
      { name: "transporter_name", label: "Transporter" },
      { name: "vehicle_number", label: "Vehicle number" },
      { name: "driver_name", label: "Driver name" },
      { name: "driver_phone", label: "Driver phone" },
      { name: "eway_bill_number", label: "E-way bill" },
      { name: "lr_number", label: "LR number" },
      { name: "packing_list_url", label: "Packing list URL" },
      { name: "proof_of_delivery_url", label: "Proof of delivery URL" },
      { name: "remarks", label: "Remarks", type: "textarea" }
    ]
  },
  production: {
    key: "production",
    title: "Production",
    databaseTitle: "Production Database",
    description: "Track production jobs by planning status, machine, order, profile, die, and planned quantity.",
    table: "production_jobs",
    select: "*, profile:aluminium_profiles(profile_code, profile_name, alloy, temper), machine:machines(machine_name), die:dies(die_number, rack_location), order:orders(order_number, priority, production_pieces, production_quantity_kg, billets_required, billets_allocated, billets_short, billet_allocation_status, customers(customer_name, company_name))",
    basePath: "/production",
    resource: "production",
    primaryAction: "Plan Job",
    databaseAction: "View Production Database",
    groupField: "status",
    groups: productionJobStatuses,
    searchPlaceholder: "Search job, order, machine, status...",
    searchFields: ["job_number", "status", "shift", "operator_name", "remarks", "notes"],
    orderIdField: "order_id",
    profileIdField: "profile_id",
    dateFilterField: "planned_date",
    defaultSort: { column: "planned_date", direction: "asc" },
    columns: [
      { id: "job_number", header: "Job Number", path: "job_number", sortable: true },
      { id: "order", header: "Order", path: "order.order_number" },
      { id: "machine", header: "Machine", path: "machine.machine_name" },
      { id: "status", header: "Status", path: "status", type: "badge", sortable: true },
      { id: "planned_date", header: "Planned Date", path: "planned_date", type: "date", sortable: true },
      { id: "pieces", header: "Pieces", path: "pieces", type: "number", sortable: true },
      { id: "planned_quantity_kg", header: "Planned Kg", path: "planned_quantity_kg", type: "weight", sortable: true }
    ],
    card: { titlePath: "job_number", subtitlePath: "order.order_number", badgePath: "status", meta: [{ label: "Machine", path: "machine.machine_name" }, { label: "Pieces", path: "pieces", type: "number" }, { label: "Planned", path: "planned_quantity_kg", type: "weight" }] },
    schema: productionJobSchema,
    numberPrefix: "J",
    numberField: "job_number",
    defaultValues: { job_number: "", order_id: "", profile_id: "", die_id: "", machine_id: "", planned_quantity_kg: 0, pieces: 0, required_billet_count: 0, extrusion_efficiency_percent: 75, length_per_piece_m: "", planned_date: "", shift: "", operator_name: "", status: "planned", remarks: "" },
    fields: [
      { name: "order_id", label: "Order", type: "select", required: true, lookup: orderLookup },
      { name: "profile_id", label: "Profile", type: "select", required: true, lookup: profileLookup },
      { name: "die_id", label: "Die", type: "select", required: true, lookup: { table: "dies", select: "id, die_number, profile_id, die_status", labelFields: ["die_number"], orderBy: "die_number" } },
      { name: "machine_id", label: "Machine", type: "select", lookup: { table: "machines", select: "id, machine_name", labelFields: ["machine_name"], orderBy: "machine_name" } },
      { name: "planned_quantity_kg", label: "Planned kg", type: "number", required: true, step: "0.001" },
      { name: "pieces", label: "Pieces", type: "number" },
      { name: "required_billet_count", label: "Required billets", type: "number" },
      { name: "extrusion_efficiency_percent", label: "Extrusion efficiency %", type: "number", step: "0.01" },
      { name: "length_per_piece_m", label: "Length per piece m", type: "number", step: "0.001" },
      { name: "planned_date", label: "Planned date", type: "date" },
      { name: "shift", label: "Shift" },
      { name: "operator_name", label: "Operator" },
      { name: "status", label: "Planning status", type: "select", options: options(productionJobStatuses.filter((status) => status !== "completed")) },
      { name: "remarks", label: "Remarks", type: "textarea" }
    ]
  },
  foundry: {
    key: "foundry",
    title: "Foundry",
    databaseTitle: "Foundry Database",
    description: "Track furnace heats, percentage-based scrap and external aluminium mix, billet alloy chemistry, temper, size, count, and calculated billet weight.",
    table: "foundry_batches",
    select: "*",
    basePath: "/foundry",
    resource: "foundry",
    primaryAction: "Create Foundry Batch",
    databaseAction: "View Foundry Database",
    groupField: "status",
    groups: foundryBatchStatuses,
    searchPlaceholder: "Search batch, furnace, alloy, temper, heat number...",
    searchFields: ["batch_number", "furnace_number", "furnace_name", "alloy", "temper", "heat_number", "status"],
    dateFilterField: "production_date",
    secondaryFilter: { field: "alloy", label: "Alloy", options: options([...standardAlloys]) },
    defaultSort: { column: "production_date", direction: "desc" },
    columns: [
      { id: "batch_number", header: "Batch ID", path: "batch_number", sortable: true },
      { id: "furnace_number", header: "Furnace", path: "furnace_number", sortable: true },
      { id: "status", header: "Status", path: "status", type: "badge", sortable: true },
      { id: "alloy", header: "Alloy", path: "alloy", sortable: true },
      { id: "temper", header: "Temper", path: "temper", sortable: true },
      { id: "billet_count", header: "Billets", path: "billet_count", type: "number", sortable: true },
      { id: "furnace_efficiency_percent", header: "Furnace Eff", path: "furnace_efficiency_percent", type: "number", sortable: true },
      { id: "required_furnace_charge_kg", header: "Charge Kg", path: "required_furnace_charge_kg", type: "weight", sortable: true },
      { id: "total_billet_weight_density_kg", header: "Total Billet Kg", path: "total_billet_weight_density_kg", type: "weight", sortable: true },
      { id: "production_date", header: "Date", path: "production_date", type: "date", sortable: true }
    ],
    card: { titlePath: "batch_number", subtitlePath: "furnace_number", badgePath: "status", meta: [{ label: "Alloy", path: "alloy" }, { label: "Billets", path: "billet_count", type: "number" }, { label: "Charge", path: "required_furnace_charge_kg", type: "weight" }, { label: "Billet Weight", path: "total_billet_weight_density_kg", type: "weight" }] },
    schema: foundryBatchSchema,
    numberPrefix: "FB",
    numberField: "batch_number",
    defaultValues: { batch_number: "", furnace_number: "F1", furnace_name: "", batch_sequence: 1, production_date: new Date().toISOString().slice(0, 10), scrap_id: "", external_source_id: "", scrap_percentage: 0, external_aluminium_percentage: 100, furnace_efficiency_percent: 80, required_furnace_charge_kg: 0, scrap_aluminium_kg: 0, external_aluminium_kg: 0, ingot_kg: 0, alloy: "6063", temper: "T6", alloy_density_kg_m3: 2700, billet_length_mm: 5800, billet_diameter_inch: 6, billet_diameter_mm: 152.4, billet_count: 24, alloy_composition_default: {}, alloy_composition_actual: {}, alloy_composition_altered: false, alloy_composition_source: "", status: "planned", heat_number: "", notes: "" },
    fields: [
      { name: "batch_number", label: "Foundry batch ID", readOnly: true, placeholder: "Auto-filled on save (F{Furnace}-{Date}-{Sequence})" },
      { name: "furnace_number", label: "Furnace number", required: true },
      { name: "furnace_name", label: "Furnace name" },
      { name: "batch_sequence", label: "Batch sequence", type: "number", required: true },
      { name: "production_date", label: "Production date", type: "date" },
      { name: "scrap_id", label: "Scrap batch", type: "select", lookup: scrapLookup },
      { name: "external_source_id", label: "External aluminium source", type: "select", lookup: externalSourceLookup },
      { name: "scrap_percentage", label: "Scrap %", type: "number", step: "0.001" },
      { name: "external_aluminium_percentage", label: "External aluminium / ingot %", type: "number", step: "0.001" },
      { name: "furnace_efficiency_percent", label: "Furnace efficiency %", type: "number", step: "0.001" },
      { name: "required_furnace_charge_kg", label: "Required furnace charge kg", type: "number", step: "0.001", readOnly: true },
      { name: "scrap_aluminium_kg", label: "Calculated scrap kg", type: "number", step: "0.001", readOnly: true },
      { name: "external_aluminium_kg", label: "Calculated external aluminium kg", type: "number", step: "0.001", readOnly: true },
      { name: "alloy", label: "Alloy", type: "select", options: options([...standardAlloys]) },
      { name: "temper", label: "Temper", type: "select", options: options([...standardTempers]) },
      { name: "alloy_density_kg_m3", label: "Alloy density kg/m3", type: "number", required: true, step: "0.001" },
      { name: "billet_length_mm", label: "Billet length mm", type: "number", required: true, step: "0.01", readOnly: true },
      { name: "billet_diameter_inch", label: "Billet diameter inch", type: "select", required: true, options: [{ value: "6", label: "6 inch" }, { value: "4", label: "4 inch" }, { value: "5", label: "5 inch" }] },
      { name: "billet_diameter_mm", label: "Billet diameter mm", type: "number", required: true, step: "0.01", readOnly: true },
      { name: "billet_count", label: "Billet count", type: "number", required: true, readOnly: true },
      { name: "status", label: "Status", type: "select", options: options(foundryBatchStatuses) },
      { name: "heat_number", label: "Heat number" },
      { name: "notes", label: "Notes", type: "textarea" }
    ],
    detailSections: [
      { title: "Furnace Mix", fields: [{ label: "Furnace", path: "furnace_number" }, { label: "Furnace efficiency", path: "furnace_efficiency_percent", type: "number" }, { label: "Required charge", path: "required_furnace_charge_kg", type: "weight" }, { label: "Scrap %", path: "scrap_percentage", type: "number" }, { label: "Scrap kg", path: "scrap_aluminium_kg", type: "weight" }, { label: "External %", path: "external_aluminium_percentage", type: "number" }, { label: "External kg", path: "external_aluminium_kg", type: "weight" }] },
      { title: "Billet Output", fields: [{ label: "Alloy", path: "alloy" }, { label: "Temper", path: "temper" }, { label: "Billet count", path: "billet_count", type: "number" }, { label: "Billet diameter inch", path: "billet_diameter_inch", type: "number" }, { label: "Billet diameter mm", path: "billet_diameter_mm", type: "number" }, { label: "Billet length mm", path: "billet_length_mm", type: "number" }, { label: "Billet weight", path: "billet_weight_density_kg", type: "weight" }, { label: "Total billet weight", path: "total_billet_weight_density_kg", type: "weight" }] },
      { title: "Chemistry", fields: [{ label: "Chemistry altered", path: "alloy_composition_altered" }, { label: "Source", path: "alloy_composition_source" }, { label: "Heat number", path: "heat_number" }, { label: "Notes", path: "notes" }] }
    ]
  },
  foundry_external_sources: {
    key: "foundry_external_sources",
    title: "External Aluminium Sources",
    databaseTitle: "External Aluminium Sources Database",
    description: "Itemize and trace external aluminium inputs such as ingot, bar, billet, wire, and chips by vendor, origin, weight, and quantity.",
    table: "foundry_external_aluminium_sources",
    select: "*, vendors(vendor_name, vendor_type, phone)",
    basePath: "/foundry/external-sources",
    resource: "foundry",
    primaryAction: "Add Source",
    databaseAction: "View Sources Database",
    groupField: "status",
    groups: ["available", "reserved", "used", "rejected", "returned"],
    searchPlaceholder: "Search source ID, type, vendor, origin, alloy...",
    searchFields: ["source_number", "item_type", "source_origin", "alloy", "quality_grade", "status"],
    dateFilterField: "received_date",
    secondaryFilter: { field: "item_type", label: "Item Type", options: options(externalAluminiumSourceTypes) },
    defaultSort: { column: "received_date", direction: "desc" },
    columns: [
      { id: "source_number", header: "Source ID", path: "source_number", sortable: true },
      { id: "item_type", header: "Item", path: "item_type", type: "badge", sortable: true },
      { id: "weight_kg", header: "Weight", path: "weight_kg", type: "weight", sortable: true },
      { id: "available_weight_kg", header: "Available", path: "available_weight_kg", type: "weight", sortable: true },
      { id: "quantity", header: "Quantity", path: "quantity", type: "number", sortable: true },
      { id: "vendor", header: "Vendor", path: "vendors.vendor_name" },
      { id: "status", header: "Status", path: "status", type: "badge", sortable: true },
      { id: "received_date", header: "Received", path: "received_date", type: "date", sortable: true }
    ],
    card: { titlePath: "source_number", subtitlePath: "vendors.vendor_name", badgePath: "item_type", meta: [{ label: "Weight", path: "weight_kg", type: "weight" }, { label: "Quantity", path: "quantity", type: "number" }, { label: "Status", path: "status", type: "badge" }] },
    schema: externalAluminiumSourceSchema,
    numberPrefix: "EAS",
    numberField: "source_number",
    defaultValues: { source_number: "", item_type: "aluminum_ingot", weight_kg: 0, unit: "kg", rate: 0, base_amount: 0, tax_amount: 0, freight_amount: 0, discount_amount: 0, total_amount: 0, invoice_number: "", invoice_date: "", due_date: "", payment_status: "unpaid", payment_method: "", available_weight_kg: "", quantity: 1, vendor_id: "", source_origin: "", received_date: new Date().toISOString().slice(0, 10), alloy: "6063", quality_grade: "", status: "available", notes: "" },
    fields: [
      { name: "source_number", label: "Source ID", readOnly: true, placeholder: "Auto-filled on save" },
      { name: "item_type", label: "Item type", type: "select", options: options(externalAluminiumSourceTypes) },
      { name: "weight_kg", label: "Weight kg", type: "number", required: true, step: "0.001" },
      { name: "unit", label: "Unit", required: true },
      { name: "rate", label: "Rate", type: "number", step: "0.01" },
      { name: "base_amount", label: "Base amount", type: "number", step: "0.01" },
      { name: "tax_amount", label: "Tax amount", type: "number", step: "0.01" },
      { name: "freight_amount", label: "Freight amount", type: "number", step: "0.01" },
      { name: "discount_amount", label: "Discount amount", type: "number", step: "0.01" },
      { name: "total_amount", label: "Total amount", type: "number", step: "0.01" },
      { name: "invoice_number", label: "Invoice number" },
      { name: "invoice_date", label: "Invoice date", type: "date" },
      { name: "due_date", label: "Due date", type: "date" },
      { name: "payment_status", label: "Payment status", type: "select", options: options(["unpaid", "partially_paid", "paid", "overdue", "cancelled", "reversed"]) },
      { name: "payment_method", label: "Payment method" },
      { name: "available_weight_kg", label: "Available kg", type: "number", step: "0.001", readOnly: true },
      { name: "quantity", label: "Quantity", type: "number", step: "0.001" },
      { name: "vendor_id", label: "Vendor", type: "select", lookup: vendorLookup },
      { name: "source_origin", label: "Where did it come from", required: true },
      { name: "received_date", label: "Received date", type: "date" },
      { name: "alloy", label: "Alloy" },
      { name: "quality_grade", label: "Quality grade" },
      { name: "status", label: "Status", type: "select", options: options(["available", "reserved", "used", "rejected", "returned"]) },
      { name: "notes", label: "Notes", type: "textarea" }
    ],
    relatedRecords: [
      { label: "Posted Expenses", table: "expense_ledger", field: "source_record_id", href: "/expenses/database", hint: "Expense ledger rows automatically created from this external source." }
    ]
  },
  foundry_billets: {
    key: "foundry_billets",
    title: "Aluminium Billets",
    databaseTitle: "Aluminium Billets Database",
    description: "Track all cast billets, their dimensions, and allocation status.",
    table: "foundry_billets",
    select: "*, foundry_batches(batch_number), outsourced_billet_batches(batch_number), orders(order_number, priority), order_billet_requirements(billets_required, billets_allocated, billets_short, status)",
    basePath: "/foundry/billets",
    resource: "foundry",
    primaryAction: "Add Billet",
    databaseAction: "View Billets Database",
    groupField: "status",
    groups: ["planned", "cast", "allocated", "issued", "consumed", "scrap", "cancelled"],
    searchPlaceholder: "Search billet code, alloy...",
    searchFields: ["billet_code", "alloy", "temper", "status", "source_type"],
    dateFilterField: "created_at",
    defaultSort: { column: "created_at", direction: "desc" },
    columns: [
      { id: "billet_code", header: "Billet ID", path: "billet_code", sortable: true },
      { id: "batch", header: "Batch", path: "foundry_batches.batch_number" },
      { id: "source_type", header: "Source", path: "source_type", type: "badge", sortable: true },
      { id: "alloy", header: "Alloy", path: "alloy", sortable: true },
      { id: "diameter", header: "Diameter", path: "billet_diameter_inch", type: "number", sortable: true },
      { id: "order", header: "Order", path: "orders.order_number" },
      { id: "weight_kg", header: "Weight", path: "weight_kg", type: "weight", sortable: true },
      { id: "status", header: "Status", path: "status", type: "badge", sortable: true },
      { id: "created_at", header: "Date", path: "created_at", type: "date", sortable: true }
    ],
    card: { titlePath: "billet_code", subtitlePath: "orders.order_number", badgePath: "status", meta: [{ label: "Source", path: "source_type", type: "badge" }, { label: "Alloy", path: "alloy" }, { label: "Diameter", path: "billet_diameter_inch", type: "number" }, { label: "Weight", path: "weight_kg", type: "weight" }] },
    schema: null as any,
    numberPrefix: "BIL" as any,
    numberField: "billet_code",
    defaultValues: {},
    fields: [
      { name: "status", label: "Status", type: "select", options: options(["planned", "cast", "allocated", "issued", "consumed", "scrap", "cancelled"]) }
    ]
  },
  machines: {
    key: "machines",
    title: "Machines",
    databaseTitle: "Machines Database",
    description: "Manage plant machinery, equipment records, and maintenance logs.",
    table: "machines",
    select: "*",
    basePath: "/machines",
    resource: "machine_maintenance",
    primaryAction: "Add Machine",
    databaseAction: "View Machines Database",
    groupField: "status",
    groups: ["active", "maintenance", "breakdown", "idle"],
    searchPlaceholder: "Search machine code, name, model...",
    searchFields: ["machine_code", "machine_name", "manufacturer"],
    dateFilterField: "created_at",
    defaultSort: { column: "machine_name", direction: "asc" },
    columns: [
      { id: "machine_code", header: "Machine ID", path: "machine_code", sortable: true },
      { id: "machine_name", header: "Name", path: "machine_name", sortable: true },
      { id: "machine_type", header: "Type", path: "machine_type", type: "badge", sortable: true },
      { id: "manufacturer", header: "Manufacturer", path: "manufacturer" },
      { id: "status", header: "Status", path: "status", type: "badge", sortable: true },
      { id: "created_at", header: "Date Added", path: "created_at", type: "date", sortable: true }
    ],
    card: { titlePath: "machine_name", subtitlePath: "machine_code", badgePath: "status", meta: [{ label: "Type", path: "machine_type", type: "badge" }, { label: "Manufacturer", path: "manufacturer" }] },
    schema: machineSchema,
    numberField: "machine_code",
    generateNumber: (payload, existing) => {
      const typeMap: Record<string, string> = { extrusion_press: "EM", aging_oven: "AO", powder_coating_line: "PCL", anodizing_line: "AL", cutting_machine: "CM", packing_station: "PS", cnc: "CNC", other: "MACH" };
      const prefix = typeMap[payload.machine_type] || "MACH";
      const max = existing.reduce((current, val) => {
        if (val.startsWith(prefix)) {
          const num = parseInt(val.slice(prefix.length), 10);
          return !isNaN(num) ? Math.max(current, num) : current;
        }
        return current;
      }, 0);
      return `${prefix}${max + 1}`;
    },
    defaultValues: { status: "active", machine_name: "", machine_type: "extrusion_press", manufacturer: "", purchase_date: "", maintenance_connected: false },
    fields: [
      { name: "machine_code", label: "Machine ID (Auto-generated)", type: "text", readOnly: true, placeholder: "Auto-filled on save" },
      { name: "machine_name", label: "Machine Name", type: "text", required: true },
      { name: "machine_type", label: "Machine Type", type: "select", options: options(["extrusion_press", "aging_oven", "powder_coating_line", "anodizing_line", "cutting_machine", "packing_station", "cnc", "other"]), required: true },
      { name: "status", label: "Status", type: "select", options: options(["active", "maintenance", "breakdown", "idle"]), required: true },
      { name: "manufacturer", label: "Manufacturer", type: "text" },
      { name: "press_capacity_ton", label: "Press Capacity (Ton)", type: "number" },
      { name: "purchase_date", label: "Purchase Date", type: "date" },
      { name: "maintenance_connected", label: "Maintenance Connected", type: "checkbox" }
    ]
  },
  outsourced_billets: {
    key: "outsourced_billets",
    title: "Outsourced Billets",
    databaseTitle: "Outsourced Billets Database",
    description: "Track batches of billets bought from outside vendors.",
    table: "outsourced_billet_batches",
    select: "*, vendors(vendor_name)",
    basePath: "/foundry/outsourced-billets",
    resource: "foundry",
    primaryAction: "Receive Billets",
    databaseAction: "View Outsourced Billets Database",
    groupField: "status",
    groups: ["received", "consumed", "cancelled"],
    searchPlaceholder: "Search batch number, alloy, vendor...",
    searchFields: ["batch_number", "alloy", "temper", "status"],
    dateFilterField: "received_date",
    defaultSort: { column: "received_date", direction: "desc" },
    columns: [
      { id: "batch_number", header: "Batch ID", path: "batch_number", sortable: true },
      { id: "vendor", header: "Vendor", path: "vendors.vendor_name" },
      { id: "alloy", header: "Alloy", path: "alloy", sortable: true },
      { id: "billet_count", header: "Count", path: "billet_count", type: "number", sortable: true },
      { id: "weight_kg", header: "Weight", path: "weight_kg", type: "weight", sortable: true },
      { id: "status", header: "Status", path: "status", type: "badge", sortable: true },
      { id: "received_date", header: "Date", path: "received_date", type: "date", sortable: true }
    ],
    card: { titlePath: "batch_number", subtitlePath: "vendors.vendor_name", badgePath: "status", meta: [{ label: "Alloy", path: "alloy" }, { label: "Weight", path: "weight_kg", type: "weight" }] },
    schema: null as any,
    numberPrefix: "OBB",
    numberField: "batch_number",
    defaultValues: { batch_number: "", vendor_id: "", received_date: new Date().toISOString().slice(0, 10), alloy: "6063", temper: "T6", billet_count: 0, billet_diameter_inch: 6, billet_diameter_mm: 152.4, billet_length_mm: 5800, weight_kg: 0, unit: "kg", price_per_kg: 0, base_amount: 0, tax_amount: 0, freight_amount: 0, discount_amount: 0, total_price: 0, invoice_number: "", invoice_date: "", due_date: "", payment_status: "unpaid", payment_method: "", status: "received", notes: "" },
    fields: [
      { name: "batch_number", label: "Batch number" },
      { name: "vendor_id", label: "Vendor", type: "select", lookup: vendorLookup },
      { name: "received_date", label: "Received date", type: "date" },
      { name: "alloy", label: "Alloy", type: "select", options: options([...standardAlloys]) },
      { name: "temper", label: "Temper", type: "select", options: options([...standardTempers]) },
      { name: "billet_count", label: "Billet count", type: "number" },
      { name: "billet_diameter_inch", label: "Diameter inch", type: "select", options: [{ value: "6", label: "6 inch" }, { value: "4", label: "4 inch" }, { value: "5", label: "5 inch" }] },
      { name: "billet_diameter_mm", label: "Diameter mm", type: "number" },
      { name: "billet_length_mm", label: "Length mm", type: "number" },
      { name: "weight_kg", label: "Total weight (kg)", type: "number" },
      { name: "unit", label: "Unit", required: true },
      { name: "price_per_kg", label: "Price per kg", type: "number" },
      { name: "base_amount", label: "Base amount", type: "number", step: "0.01" },
      { name: "tax_amount", label: "Tax amount", type: "number", step: "0.01" },
      { name: "freight_amount", label: "Freight amount", type: "number", step: "0.01" },
      { name: "discount_amount", label: "Discount amount", type: "number", step: "0.01" },
      { name: "total_price", label: "Total amount", type: "number", step: "0.01" },
      { name: "invoice_number", label: "Invoice number" },
      { name: "invoice_date", label: "Invoice date", type: "date" },
      { name: "due_date", label: "Due date", type: "date" },
      { name: "payment_status", label: "Payment status", type: "select", options: options(["unpaid", "partially_paid", "paid", "overdue", "cancelled", "reversed"]) },
      { name: "payment_method", label: "Payment method" },
      { name: "status", label: "Status", type: "select", options: options(["received", "consumed", "cancelled"]) },
      { name: "notes", label: "Notes", type: "textarea" }
    ],
    relatedRecords: [
      { label: "Posted Expenses", table: "expense_ledger", field: "source_record_id", href: "/expenses/database", hint: "Expense ledger rows automatically created from this outsourced billet batch." }
    ]
  },
  foundry_scrap: {
    key: "foundry_scrap",
    title: "Aluminium Scrap",
    databaseTitle: "Aluminium Scrap Database",
    description: "Track incoming and in-house scrap by supplier, quality, weight, status, and usage readiness.",
    table: "foundry_aluminium_scrap",
    select: "*, vendors(vendor_name, vendor_type, phone)",
    basePath: "/foundry/scrap",
    resource: "foundry",
    primaryAction: "Add Scrap",
    databaseAction: "View Scrap Database",
    groupField: "status",
    groups: ["available", "reserved", "used", "rejected"],
    searchPlaceholder: "Search scrap ID, source, vendor, quality...",
    searchFields: ["scrap_number", "scrap_source", "scrap_quality", "origin_reference", "status"],
    dateFilterField: "received_date",
    secondaryFilter: { field: "scrap_quality", label: "Quality", options: options(aluminiumScrapQualities) },
    defaultSort: { column: "received_date", direction: "desc" },
    columns: [
      { id: "scrap_number", header: "Scrap ID", path: "scrap_number", sortable: true },
      { id: "scrap_source", header: "Source", path: "scrap_source", type: "badge", sortable: true },
      { id: "weight_kg", header: "Weight", path: "weight_kg", type: "weight", sortable: true },
      { id: "vendor", header: "Vendor", path: "vendors.vendor_name" },
      { id: "scrap_quality", header: "Quality", path: "scrap_quality", type: "badge", sortable: true },
      { id: "status", header: "Status", path: "status", type: "badge", sortable: true },
      { id: "received_date", header: "Received", path: "received_date", type: "date", sortable: true }
    ],
    card: { titlePath: "scrap_number", subtitlePath: "vendors.vendor_name", badgePath: "scrap_quality", meta: [{ label: "Source", path: "scrap_source", type: "badge" }, { label: "Weight", path: "weight_kg", type: "weight" }, { label: "Available", path: "available_weight_kg", type: "weight" }] },
    schema: aluminiumScrapSchema,
    numberPrefix: "SCR",
    numberField: "scrap_number",
    defaultValues: { scrap_number: "", scrap_source: "incoming", weight_kg: 0, unit: "kg", rate: 0, base_amount: 0, tax_amount: 0, freight_amount: 0, discount_amount: 0, total_amount: 0, invoice_number: "", invoice_date: "", due_date: "", payment_status: "unpaid", payment_method: "", available_weight_kg: "", vendor_id: "", scrap_quality: "clean", received_date: new Date().toISOString().slice(0, 10), origin_reference: "", status: "available", notes: "" },
    fields: [
      { name: "scrap_number", label: "Scrap ID", readOnly: true, placeholder: "Auto-filled on save" },
      { name: "scrap_source", label: "Scrap source", type: "select", options: options(["incoming", "in_house"]) },
      { name: "weight_kg", label: "Scrap weight kg", type: "number", required: true, step: "0.001" },
      { name: "unit", label: "Unit", required: true },
      { name: "rate", label: "Rate", type: "number", step: "0.01" },
      { name: "base_amount", label: "Base amount", type: "number", step: "0.01" },
      { name: "tax_amount", label: "Tax amount", type: "number", step: "0.01" },
      { name: "freight_amount", label: "Freight amount", type: "number", step: "0.01" },
      { name: "discount_amount", label: "Discount amount", type: "number", step: "0.01" },
      { name: "total_amount", label: "Total amount", type: "number", step: "0.01" },
      { name: "invoice_number", label: "Invoice number" },
      { name: "invoice_date", label: "Invoice date", type: "date" },
      { name: "due_date", label: "Due date", type: "date" },
      { name: "payment_status", label: "Payment status", type: "select", options: options(["unpaid", "partially_paid", "paid", "overdue", "cancelled", "reversed"]) },
      { name: "payment_method", label: "Payment method" },
      { name: "available_weight_kg", label: "Available kg", type: "number", step: "0.001", readOnly: true },
      { name: "vendor_id", label: "Vendor", type: "select", lookup: vendorLookup },
      { name: "scrap_quality", label: "Scrap quality", type: "select", options: options(aluminiumScrapQualities) },
      { name: "received_date", label: "Received date", type: "date" },
      { name: "origin_reference", label: "Origin reference" },
      { name: "status", label: "Status", type: "select", options: options(["available", "reserved", "used", "rejected"]) },
      { name: "notes", label: "Notes", type: "textarea" }
    ],
    relatedRecords: [
      { label: "Posted Expenses", table: "expense_ledger", field: "source_record_id", href: "/expenses/database", hint: "Expense ledger rows automatically created from this scrap purchase." }
    ]
  },
  packaging: {
    key: "packaging",
    title: "Packaging",
    databaseTitle: "Packaging Database",
    description: "Schedule packaging for completed production jobs.",
    table: "packaging_jobs",
    select: "*, orders(order_number, priority, customers(customer_name, company_name)), production_jobs(job_number, profile:aluminium_profiles(profile_code, profile_name))",
    basePath: "/packaging",
    resource: "packaging",
    primaryAction: "Schedule Packaging",
    databaseAction: "View Packaging Database",
    groupField: "status",
    groups: packagingJobStatuses,
    searchPlaceholder: "Search packaging ID, order, status...",
    searchFields: ["packaging_number", "status", "notes"],
    orderIdField: "order_id",
    dateFilterField: "scheduled_date",
    defaultSort: { column: "scheduled_date", direction: "asc" },
    columns: [
      { id: "packaging_number", header: "Packaging ID", path: "packaging_number", sortable: true },
      { id: "order", header: "Order", path: "orders.order_number" },
      { id: "pieces", header: "Pieces", path: "pieces", type: "number", sortable: true },
      { id: "profile_weight_kg", header: "Weight", path: "profile_weight_kg", type: "weight", sortable: true },
      { id: "status", header: "Status", path: "status", type: "badge", sortable: true }
    ],
    card: { titlePath: "packaging_number", subtitlePath: "orders.order_number", badgePath: "status", meta: [{ label: "Pieces", path: "pieces", type: "number" }, { label: "Weight", path: "profile_weight_kg", type: "weight" }] },
    schema: packagingJobSchema,
    numberPrefix: "PKG",
    numberField: "packaging_number",
    defaultValues: { packaging_number: "", order_id: "", production_job_id: "", scheduled_date: new Date().toISOString().slice(0, 10), pieces: 0, profile_weight_kg: 0, profile_length_m: 0, status: "scheduled", notes: "" },
    fields: [
      { name: "packaging_number", label: "Packaging ID" },
      { name: "order_id", label: "Order waiting packaging", type: "select", required: true, lookup: orderLookup },
      { name: "production_job_id", label: "Completed production job", type: "select", required: true, lookup: { table: "production_jobs", select: "id, job_number, order_id, status", labelFields: ["job_number"], orderBy: "created_at", filter: { status: "completed" } } },
      { name: "scheduled_date", label: "Scheduled date", type: "date" },
      { name: "pieces", label: "Pieces", type: "number" },
      { name: "profile_weight_kg", label: "Profile weight kg", type: "number", step: "0.001" },
      { name: "profile_length_m", label: "Profile length m", type: "number", step: "0.001" },
      { name: "status", label: "Status", type: "select", options: options(packagingJobStatuses) },
      { name: "notes", label: "Notes", type: "textarea" }
    ],
    emptyState: { title: "No packaging jobs", description: "Schedule packaging for finished production jobs." },
    detailIntro: "Add materials required for this packaging job.",
    detailSections: [
      { title: "Job Details", fields: [{ label: "Order", path: "orders.order_number" }, { label: "Scheduled", path: "scheduled_date", type: "date" }, { label: "Pieces", path: "pieces", type: "number" }, { label: "Weight", path: "profile_weight_kg", type: "weight" }] }
    ],
    relatedRecords: [
      { label: "Used Materials", table: "packaging_job_materials", field: "job_id", href: "#", hint: "Materials allocated to this packaging job" }
    ]
  },
  packaging_materials: {
    key: "packaging_materials",
    title: "Packaging Material Inventory",
    databaseTitle: "Packaging Material Inventory",
    description: "Track packaging material stock, reorder levels, consumption rate, location, and vendor.",
    table: "packaging_materials",
    select: "*, vendors(vendor_name, vendor_type, phone)",
    basePath: "/packaging/materials",
    resource: "packaging",
    primaryAction: "Add Packaging Material",
    databaseAction: "View Material Inventory",
    groupField: "material_type",
    groups: [...packagingMaterialTypes],
    searchPlaceholder: "Search material code, name, type, vendor, location...",
    searchFields: ["material_code", "material_name", "material_type", "location"],
    secondaryFilter: { field: "is_active", label: "Status", options: [{ value: "true", label: "Active" }, { value: "false", label: "Inactive" }] },
    defaultSort: { column: "material_code", direction: "asc" },
    columns: [
      { id: "material_code", header: "Code", path: "material_code", sortable: true },
      { id: "material_name", header: "Material", path: "material_name", sortable: true },
      { id: "material_type", header: "Type", path: "material_type", type: "badge", sortable: true },
      { id: "current_stock", header: "Stock", path: "current_stock", type: "number", sortable: true },
      { id: "reorder_level", header: "Reorder", path: "reorder_level", type: "number", sortable: true },
      { id: "vendor", header: "Vendor", path: "vendors.vendor_name" }
    ],
    card: { titlePath: "material_code", subtitlePath: "material_name", badgePath: "material_type", meta: [{ label: "Stock", path: "current_stock", type: "number" }, { label: "Reorder", path: "reorder_level", type: "number" }, { label: "Vendor", path: "vendors.vendor_name" }] },
    schema: packagingMaterialSchema,
    numberField: "material_code",
    generateNumber: (payload, existing) => {
      const typeMap: Record<string, string> = {
        stretch_film: "SF", bubble_wrap: "BW", paper: "PAPER", hdpe: "HDPE",
        pp_woven_sheet: "PPWS", wooden_crate: "WC", strapping: "STRAP", corner_protector: "CP"
      };
      const prefix = typeMap[payload.material_type] || "PKG";
      const max = existing.reduce((current, val) => {
        if (val && val.startsWith(prefix + "-")) {
          const num = parseInt(val.slice(prefix.length + 1), 10);
          if (!isNaN(num) && num > current) return num;
        }
        return current;
      }, 0);
      return `${prefix}-${(max + 1).toString().padStart(3, "0")}`;
    },
    defaultValues: { material_code: "", material_name: "", material_type: "stretch_film", unit: "meter", current_stock: 0, reorder_level: 0, calculation_method: "per_profile_meter", consumption_rate: 1, vendor_id: "", location: "", is_active: true },
    fields: [
      { name: "material_code", label: "Material code (auto-generated)", readOnly: true },
      { name: "material_name", label: "Material name", required: true },
      { name: "material_type", label: "Material type", type: "select", options: options([...packagingMaterialTypes]) },
      { name: "unit", label: "Unit", required: true },
      { name: "current_stock", label: "Current stock", type: "number", step: "0.001" },
      { name: "reorder_level", label: "Reorder level", type: "number", step: "0.001" },
      { name: "calculation_method", label: "Calculation method", type: "select", options: options([...packagingCalculationMethods]) },
      { name: "consumption_rate", label: "Consumption rate", type: "number", step: "0.001" },
      { name: "vendor_id", label: "Supplier", type: "select", lookup: { table: "vendors", select: "id, vendor_name, vendor_type", labelFields: ["vendor_name"], orderBy: "vendor_name" } },
      { name: "location", label: "Storage location" },
      { name: "is_active", label: "Active", type: "checkbox" }
    ],
    relatedRecords: [
      { label: "Purchase Receipts", table: "packaging_material_purchases", field: "material_id", href: "/packaging/purchases/database", hint: "Purchased stock receipts and corresponding expense postings for this material." }
    ]
  },
  packaging_material_purchases: {
    key: "packaging_material_purchases",
    title: "Packaging Purchases",
    databaseTitle: "Packaging Purchases Database",
    description: "Record packaging material purchase receipts. Each receipt updates stock and auto-posts a linked expense ledger entry.",
    table: "packaging_material_purchases",
    select: "*, packaging_materials(material_code, material_name, material_type), vendors(vendor_name, vendor_type, phone)",
    basePath: "/packaging/purchases",
    resource: "packaging",
    primaryAction: "Add Purchase Receipt",
    databaseAction: "View Purchase Database",
    groupField: "payment_status",
    groups: ["unpaid", "partially_paid", "paid", "overdue", "cancelled", "reversed"],
    searchPlaceholder: "Search purchase number, invoice, material, vendor, payment status...",
    searchFields: ["purchase_number", "invoice_number", "notes", "payment_status"],
    dateFilterField: "received_date",
    defaultSort: { column: "received_date", direction: "desc" },
    columns: [
      { id: "purchase_number", header: "Purchase No", path: "purchase_number", sortable: true },
      { id: "received_date", header: "Date", path: "received_date", type: "date", sortable: true },
      { id: "material", header: "Material", path: "packaging_materials.material_name", sortable: true },
      { id: "vendor", header: "Vendor", path: "vendors.vendor_name", sortable: true },
      { id: "quantity", header: "Qty", path: "quantity", type: "number", sortable: true },
      { id: "rate", header: "Rate", path: "rate", type: "currency", sortable: true },
      { id: "total_amount", header: "Total", path: "total_amount", type: "currency", sortable: true },
      { id: "payment_status", header: "Payment", path: "payment_status", type: "badge", sortable: true }
    ],
    card: { titlePath: "purchase_number", subtitlePath: "packaging_materials.material_name", badgePath: "payment_status", meta: [{ label: "Vendor", path: "vendors.vendor_name" }, { label: "Qty", path: "quantity", type: "number" }, { label: "Total", path: "total_amount", type: "currency" }] },
    schema: packagingMaterialPurchaseSchema,
    numberPrefix: "PKP",
    numberField: "purchase_number",
    defaultValues: { purchase_number: "", material_id: "", vendor_id: "", received_date: new Date().toISOString().slice(0, 10), quantity: 0, unit: "meter", rate: 0, base_amount: 0, tax_amount: 0, freight_amount: 0, discount_amount: 0, total_amount: 0, invoice_number: "", invoice_date: "", due_date: "", payment_status: "unpaid", payment_method: "", notes: "" },
    fields: [
      { name: "purchase_number", label: "Purchase number", readOnly: true, placeholder: "Auto-filled on save" },
      { name: "material_id", label: "Material", type: "select", required: true, lookup: { table: "packaging_materials", select: "id, material_code, material_name, unit", labelFields: ["material_code", "material_name"], orderBy: "material_name", filter: { is_active: true } } },
      { name: "vendor_id", label: "Vendor", type: "select", required: true, lookup: vendorLookup },
      { name: "received_date", label: "Received date", type: "date", required: true },
      { name: "quantity", label: "Quantity received", type: "number", required: true, step: "0.001" },
      { name: "unit", label: "Unit", required: true },
      { name: "rate", label: "Rate", type: "number", step: "0.01" },
      { name: "base_amount", label: "Base amount", type: "number", step: "0.01" },
      { name: "tax_amount", label: "Tax amount", type: "number", step: "0.01" },
      { name: "freight_amount", label: "Freight amount", type: "number", step: "0.01" },
      { name: "discount_amount", label: "Discount amount", type: "number", step: "0.01" },
      { name: "total_amount", label: "Total amount", type: "number", step: "0.01" },
      { name: "invoice_number", label: "Invoice number" },
      { name: "invoice_date", label: "Invoice date", type: "date" },
      { name: "due_date", label: "Due date", type: "date" },
      { name: "payment_status", label: "Payment status", type: "select", options: options(["unpaid", "partially_paid", "paid", "overdue", "cancelled", "reversed"]) },
      { name: "payment_method", label: "Payment method" },
      { name: "notes", label: "Notes", type: "textarea" }
    ],
    relatedRecords: [
      { label: "Posted Expenses", table: "expense_ledger", field: "source_record_id", href: "/expenses/database", hint: "Expense ledger entries auto-created from this purchase receipt." }
    ]
  },
  packaging_job_materials: {
    key: "packaging_job_materials",
    title: "Packaging Job Materials",
    databaseTitle: "Packaging Job Materials",
    description: "Materials used for packaging jobs.",
    table: "packaging_job_materials",
    select: "*, packaging_jobs(packaging_number), packaging_materials(material_code, material_name, unit)",
    basePath: "/packaging", // hide from sidebar
    resource: "packaging",
    primaryAction: "Add Material",
    databaseAction: "View Materials",
    defaultSort: { column: "created_at", direction: "desc" },
    searchPlaceholder: "Search materials...",
    searchFields: ["packaging_materials.material_name", "packaging_materials.material_code"],
    columns: [
      { id: "job", header: "Job", path: "packaging_jobs.packaging_number", sortable: true },
      { id: "material", header: "Material", path: "packaging_materials.material_name" },
      { id: "quantity_required", header: "Quantity", path: "quantity_required", type: "number", sortable: true }
    ],
    card: { titlePath: "packaging_materials.material_name", subtitlePath: "packaging_jobs.packaging_number", meta: [{ label: "Qty", path: "quantity_required", type: "number" }] },
    schema: packagingJobMaterialSchema,
    defaultValues: { job_id: "", material_id: "", quantity_required: 1 },
    fields: [
      { name: "job_id", label: "Packaging job", type: "select", lookup: { table: "packaging_jobs", select: "id, packaging_number", labelFields: ["packaging_number"], orderBy: "packaging_number" } },
      { name: "material_id", label: "Packaging material", type: "select", lookup: { table: "packaging_materials", select: "id, material_code, material_name", labelFields: ["material_code", "material_name"], orderBy: "material_name", filter: { is_active: true } } },
      { name: "quantity_required", label: "Quantity required", type: "number", step: "0.001" }
    ]
  },
  inventory: {
    key: "inventory", title: "Inventory", databaseTitle: "Inventory Database", description: "Track billets, profiles, hardware, packing material, scrap, and finished goods by category and stock health.", table: "inventory_items", select: "*", basePath: "/inventory", resource: "inventory", primaryAction: "Add Item", databaseAction: "View Inventory Database", groupField: "item_category", groups: inventoryCategories, searchPlaceholder: "Search item code, item name, category, location...", searchFields: ["item_code", "item_name", "item_category", "location"], dateFilterField: "updated_at", secondaryFilter: { field: "is_active", label: "Status", options: [{ value: "true", label: "Active" }, { value: "false", label: "Inactive" }] }, defaultSort: { column: "updated_at", direction: "desc" }, columns: [{ id: "item_code", header: "Item Code", path: "item_code", sortable: true }, { id: "item_name", header: "Item Name", path: "item_name", sortable: true }, { id: "item_category", header: "Category", path: "item_category", type: "badge", sortable: true }, { id: "current_stock", header: "Stock", path: "current_stock", type: "number", sortable: true }, { id: "unit", header: "Unit", path: "unit" }, { id: "reorder_level", header: "Reorder Level", path: "reorder_level", type: "number", sortable: true }, { id: "location", header: "Location", path: "location" }], card: { titlePath: "item_code", subtitlePath: "item_name", badgePath: "item_category", meta: [{ label: "Stock", path: "current_stock", type: "number" }, { label: "Location", path: "location" }] }, schema: inventoryItemSchema, defaultValues: { item_code: "", item_name: "", item_category: "billets", unit: "kg", reorder_level: 0, location: "", is_active: true }, fields: [{ name: "item_code", label: "Item code", required: true }, { name: "item_name", label: "Item name", required: true }, { name: "item_category", label: "Category", type: "select", options: options(inventoryCategories) }, { name: "unit", label: "Unit", required: true }, { name: "reorder_level", label: "Reorder level", type: "number" }, { name: "location", label: "Location" }, { name: "is_active", label: "Active", type: "checkbox" }]
  },
  customers: {
    key: "customers", title: "Customers", databaseTitle: "Customer Database", description: "Manage customers by type, activity, city, contact, GST, and buying relationship.", table: "customers", select: "*", basePath: "/customers", resource: "customers", primaryAction: "Add Customer", databaseAction: "View Customer Database", groupField: "customer_type", groups: customerTypes, searchPlaceholder: "Search name, company, phone, GST, city...", searchFields: ["customer_name", "company_name", "phone", "gst_number", "city", "customer_type"], dateFilterField: "created_at", secondaryFilter: { field: "is_active", label: "Status", options: [{ value: "true", label: "Active" }, { value: "false", label: "Inactive" }] }, defaultSort: { column: "created_at", direction: "desc" }, columns: [{ id: "customer_name", header: "Customer", path: "customer_name", sortable: true }, { id: "company_name", header: "Company", path: "company_name", sortable: true }, { id: "customer_type", header: "Type", path: "customer_type", type: "badge", sortable: true }, { id: "phone", header: "Phone", path: "phone" }, { id: "gst_number", header: "GST", path: "gst_number" }, { id: "city", header: "City", path: "city", sortable: true }], card: { titlePath: "company_name", subtitlePath: "customer_name", badgePath: "customer_type", meta: [{ label: "Phone", path: "phone" }, { label: "City", path: "city" }] }, schema: customerSchema, defaultValues: { customer_name: "", company_name: "", customer_type: "fabricator", phone: "", whatsapp_number: "", email: "", gst_number: "", billing_address: "", shipping_address: "", city: "", state: "", pincode: "", contact_person: "", payment_terms: "", notes: "", is_active: true }, fields: [{ name: "customer_name", label: "Customer name", required: true }, { name: "company_name", label: "Company name" }, { name: "customer_type", label: "Customer type", type: "select", options: options(customerTypes) }, { name: "phone", label: "Phone" }, { name: "whatsapp_number", label: "WhatsApp" }, { name: "email", label: "Email" }, { name: "gst_number", label: "GST" }, { name: "city", label: "City" }, { name: "state", label: "State" }, { name: "billing_address", label: "Billing address", type: "textarea" }, { name: "notes", label: "Notes", type: "textarea" }, { name: "is_active", label: "Active", type: "checkbox" }]
  },
  profiles: {
    key: "profiles", title: "Profiles", databaseTitle: "Profile Database", description: "Manage aluminium profile master data by category, section weight, alloy, temper, and finish options.", table: "aluminium_profiles", select: "*", basePath: "/profiles", resource: "profiles", primaryAction: "Add Profile", databaseAction: "View Profile Database", groupField: "application_category", groups: applicationCategories, searchPlaceholder: "Search profile code, name, category, alloy...", searchFields: ["profile_code", "profile_name", "application_category", "alloy", "temper"], dateFilterField: "created_at", secondaryFilter: { field: "is_active", label: "Status", options: [{ value: "true", label: "Active" }, { value: "false", label: "Inactive" }] }, defaultSort: { column: "profile_code", direction: "asc" }, columns: [{ id: "profile_code", header: "Profile Code", path: "profile_code", sortable: true }, { id: "profile_name", header: "Profile Name", path: "profile_name", sortable: true }, { id: "application_category", header: "Category", path: "application_category", type: "badge", sortable: true }, { id: "section_weight_kg_per_m", header: "Kg/m", path: "section_weight_kg_per_m", type: "weight", sortable: true }, { id: "alloy", header: "Alloy", path: "alloy" }, { id: "temper", header: "Temper", path: "temper" }], card: { titlePath: "profile_code", subtitlePath: "profile_name", badgePath: "application_category", meta: [{ label: "Weight", path: "section_weight_kg_per_m", type: "weight" }, { label: "Alloy", path: "alloy" }] }, schema: profileSchema, defaultValues: { profile_code: "", profile_name: "", application_category: "sliding_window", section_weight_kg_per_m: "", alloy: "6063", temper: "T6", finish_options: "mill_finish, powder_coating, anodizing", standard_length_m: "5.8", drawing_url: "", image_url: "", notes: "", is_active: true }, fields: [{ name: "profile_code", label: "Profile code", required: true }, { name: "profile_name", label: "Profile name", required: true }, { name: "application_category", label: "Category", type: "select", options: options(applicationCategories) }, { name: "section_weight_kg_per_m", label: "Section weight kg/m", type: "number", required: true, step: "0.001" }, { name: "alloy", label: "Alloy" }, { name: "temper", label: "Temper" }, { name: "finish_options", label: "Finish options" }, { name: "standard_length_m", label: "Standard length m", type: "number", step: "0.01" }, { name: "drawing_url", label: "Drawing URL" }, { name: "notes", label: "Notes", type: "textarea" }, { name: "is_active", label: "Active", type: "checkbox" }]
  },
  quality: {
    key: "quality",
    title: "Quality",
    databaseTitle: "Quality Database",
    description: "Inspect completed production output before it is released for packaging and dispatch.",
    table: "quality_inspections",
    select: "*, aluminium_profiles(profile_code, profile_name), production_jobs(job_number), finishing_jobs(finishing_type, status)",
    basePath: "/quality",
    resource: "quality",
    primaryAction: "Add Inspection",
    databaseAction: "View Quality Database",
    groupField: "status",
    groups: qualityStatuses,
    searchPlaceholder: "Search batch, production job, profile, inspector, status...",
    searchFields: ["batch_number", "status", "inspector_name", "dimensional_variance"],
    profileIdField: "profile_id",
    dateFilterField: "inspection_date",
    secondaryFilter: { field: "surface_finish_ok", label: "Surface", options: [{ value: "true", label: "OK" }, { value: "false", label: "Failed" }] },
    defaultSort: { column: "inspection_date", direction: "desc" },
    columns: [
      { id: "batch_number", header: "Batch", path: "batch_number", sortable: true },
      { id: "production_job", header: "Production Job", path: "production_jobs.job_number" },
      { id: "profile", header: "Profile", path: "aluminium_profiles.profile_code" },
      { id: "status", header: "Status", path: "status", type: "badge", sortable: true },
      { id: "quantity_checked_kg", header: "Checked Qty", path: "quantity_checked_kg", type: "weight", sortable: true },
      { id: "inspector_name", header: "Inspector", path: "inspector_name" },
      { id: "inspection_date", header: "Inspected", path: "inspection_date", type: "date", sortable: true }
    ],
    card: { titlePath: "batch_number", subtitlePath: "production_jobs.job_number", badgePath: "status", meta: [{ label: "Profile", path: "aluminium_profiles.profile_code" }, { label: "Qty", path: "quantity_checked_kg", type: "weight" }, { label: "Inspector", path: "inspector_name" }] },
    schema: qualityInspectionSchema,
    defaultValues: { production_job_id: "", finishing_job_id: "", profile_id: "", inspection_date: new Date().toISOString().slice(0, 10), batch_number: "", quantity_checked_kg: 0, dimensional_variance: "", hardness_webster: "", surface_finish_ok: true, weight_per_meter_actual: "", status: "pending", inspector_name: "", notes: "" },
    fields: [
      { name: "production_job_id", label: "Completed production job", type: "select", required: true, lookup: { table: "production_jobs", select: "id, job_number, profile_id, order_id, status, finishing_type, actual_quantity_kg", labelFields: ["job_number"], orderBy: "created_at", filter: { status: "completed" } } },
      { name: "finishing_job_id", label: "Completed finishing job", type: "select", lookup: { table: "finishing_jobs", select: "id, production_job_id, finishing_type, status, output_weight_kg", labelFields: ["finishing_type"], orderBy: "created_at", filter: { status: "completed" } } },
      { name: "profile_id", label: "Profile", type: "select", required: true, readOnly: true, lookup: profileLookup },
      { name: "inspection_date", label: "Inspection date", type: "date", required: true },
      { name: "batch_number", label: "Batch number" },
      { name: "quantity_checked_kg", label: "Quantity checked kg", type: "number", required: true, step: "0.001" },
      { name: "dimensional_variance", label: "Dimensional variance" },
      { name: "hardness_webster", label: "Hardness", type: "number", step: "0.01" },
      { name: "weight_per_meter_actual", label: "Actual kg/m", type: "number", step: "0.001" },
      { name: "surface_finish_ok", label: "Surface finish OK", type: "checkbox" },
      { name: "status", label: "Inspection result", type: "select", options: options(qualityStatuses) },
      { name: "inspector_name", label: "Inspector" },
      { name: "notes", label: "Notes", type: "textarea" }
    ]
  },
  invoices: {
    key: "invoices", title: "Payments", databaseTitle: "Payments & Invoices Database", description: "Track invoices, payment status, due date, customer, total amount, paid amount, and balance due.", table: "invoices", select: "*, customers(customer_name, company_name)", basePath: "/invoices", resource: "financials", primaryAction: "Create Invoice", databaseAction: "View Payments Database", groupField: "status", groups: invoiceStatuses, searchPlaceholder: "Search invoice number, customer, status...", searchFields: ["invoice_number", "status", "notes"], customerIdField: "customer_id", dateFilterField: "due_date", defaultSort: { column: "due_date", direction: "asc" }, columns: [{ id: "invoice_number", header: "Invoice Number", path: "invoice_number", sortable: true }, { id: "customer", header: "Customer", path: "customers.company_name" }, { id: "status", header: "Status", path: "status", type: "badge", sortable: true }, { id: "invoice_date", header: "Invoice Date", path: "invoice_date", type: "date", sortable: true }, { id: "due_date", header: "Due Date", path: "due_date", type: "date", sortable: true }, { id: "grand_total", header: "Total", path: "grand_total", type: "currency", sortable: true }, { id: "balance_due", header: "Balance", path: "balance_due", type: "currency", sortable: true }], card: { titlePath: "invoice_number", subtitlePath: "customers.company_name", badgePath: "status", meta: [{ label: "Due", path: "due_date", type: "date" }, { label: "Balance", path: "balance_due", type: "currency" }] }, schema: invoiceSchema, defaultValues: { customer_id: "", order_id: "", dispatch_id: "", invoice_number: "", invoice_date: new Date().toISOString().slice(0, 10), due_date: "", subtotal: 0, tax_total: 0, grand_total: 0, amount_paid: 0, status: "draft", notes: "" }, fields: [{ name: "customer_id", label: "Customer", type: "select", required: true, lookup: customerLookup }, { name: "invoice_number", label: "Invoice number" }, { name: "invoice_date", label: "Invoice date", type: "date", required: true }, { name: "due_date", label: "Due date", type: "date" }, { name: "subtotal", label: "Subtotal", type: "number" }, { name: "tax_total", label: "Tax", type: "number" }, { name: "grand_total", label: "Grand total", type: "number" }, { name: "amount_paid", label: "Amount paid", type: "number" }, { name: "status", label: "Status", type: "select", options: options(invoiceStatuses) }, { name: "notes", label: "Notes", type: "textarea" }]
  },
  vendors: {
    key: "vendors", title: "Vendors", databaseTitle: "Vendor Database", description: "Manage aluminium metal suppliers, die makers, transporters, finishing vendors, packing suppliers, and maintenance partners.", table: "vendors", select: "*", basePath: "/vendors", resource: "vendors", primaryAction: "Add Vendor", databaseAction: "View Vendor Database", groupField: "vendor_type", groups: vendorTypes, searchPlaceholder: "Search vendor, type, phone, GST, city...", searchFields: ["vendor_name", "vendor_type", "contact_person", "phone", "gst_number", "city"], dateFilterField: "created_at", secondaryFilter: { field: "is_active", label: "Status", options: [{ value: "true", label: "Active" }, { value: "false", label: "Inactive" }] }, defaultSort: { column: "created_at", direction: "desc" }, columns: [{ id: "vendor_name", header: "Vendor", path: "vendor_name", sortable: true }, { id: "vendor_type", header: "Type", path: "vendor_type", type: "badge", sortable: true }, { id: "contact_person", header: "Contact", path: "contact_person" }, { id: "phone", header: "Phone", path: "phone" }, { id: "city", header: "City", path: "city", sortable: true }, { id: "gst_number", header: "GST", path: "gst_number" }], card: { titlePath: "vendor_name", subtitlePath: "contact_person", badgePath: "vendor_type", meta: [{ label: "Phone", path: "phone" }, { label: "City", path: "city" }] }, schema: vendorSchema, defaultValues: { vendor_name: "", vendor_type: "aluminum_billets", contact_person: "", phone: "", email: "", gst_number: "", address: "", city: "", state: "", payment_terms: "", notes: "", is_active: true }, fields: [{ name: "vendor_name", label: "Vendor name", required: true }, { name: "vendor_type", label: "Vendor type", type: "select", options: options(vendorTypes) }, { name: "contact_person", label: "Contact person" }, { name: "phone", label: "Phone" }, { name: "email", label: "Email" }, { name: "gst_number", label: "GST" }, { name: "city", label: "City" }, { name: "state", label: "State" }, { name: "address", label: "Address", type: "textarea" }, { name: "payment_terms", label: "Payment terms" }, { name: "notes", label: "Notes", type: "textarea" }, { name: "is_active", label: "Active", type: "checkbox" }]
  },
  tasks: {
    key: "tasks", title: "Tasks", databaseTitle: "Tasks Database", description: "Manage dealer and internal tasks.", table: "tasks", select: "*", basePath: "/tasks", resource: "orders", primaryAction: "Create Task", databaseAction: "View Tasks Database", groupField: "status", groups: ["open", "in_progress", "completed", "cancelled"], searchPlaceholder: "Search task title, description...", searchFields: ["title", "description", "status"], dateFilterField: "due_date", defaultSort: { column: "created_at", direction: "desc" }, columns: [{ id: "title", header: "Title", path: "title", sortable: true }, { id: "status", header: "Status", path: "status", type: "badge", sortable: true }, { id: "priority", header: "Priority", path: "priority", type: "badge", sortable: true }, { id: "due_date", header: "Due Date", path: "due_date", type: "date", sortable: true }], card: { titlePath: "title", badgePath: "status", meta: [{ label: "Due", path: "due_date", type: "date" }] }, defaultValues: { title: "", description: "", priority: "normal", status: "open", due_date: "" }, fields: [{ name: "title", label: "Title", required: true }, { name: "description", label: "Description", type: "textarea" }, { name: "priority", label: "Priority", type: "select", options: options(["low", "normal", "high", "urgent"]) }, { name: "status", label: "Status", type: "select", options: options(["open", "in_progress", "completed", "cancelled"]) }, { name: "due_date", label: "Due date", type: "date" }]
  },
  payments: {
    key: "payments", title: "Dealer Payments", databaseTitle: "Dealer Payments", description: "Manage payments and receipts.", table: "payments", select: "*", basePath: "/payments", resource: "financials", primaryAction: "Record Payment", databaseAction: "View Payments", groupField: "payment_status", groups: ["PENDING", "PAID", "PARTIALLY_PAID", "FAILED", "REFUNDED", "CANCELLED"], searchPlaceholder: "Search reference, method...", searchFields: ["reference_number", "payment_method", "notes"], dateFilterField: "payment_date", defaultSort: { column: "payment_date", direction: "desc" }, columns: [{ id: "payment_date", header: "Date", path: "payment_date", type: "date", sortable: true }, { id: "amount", header: "Amount", path: "amount", type: "currency", sortable: true }, { id: "payment_method", header: "Method", path: "payment_method", sortable: true }, { id: "payment_type", header: "Type", path: "payment_type", type: "badge", sortable: true }, { id: "payment_status", header: "Status", path: "payment_status", type: "badge", sortable: true }], card: { titlePath: "payment_method", badgePath: "payment_status", meta: [{ label: "Date", path: "payment_date", type: "date" }, { label: "Amount", path: "amount", type: "currency" }] }, defaultValues: { payment_date: new Date().toISOString().slice(0, 10), amount: 0, payment_method: "bank_transfer", payment_status: "PENDING", reference_number: "", notes: "" }, fields: [{ name: "payment_date", label: "Date", type: "date", required: true }, { name: "amount", label: "Amount", type: "number", required: true }, { name: "payment_method", label: "Method", type: "select", options: options(["bank_transfer", "upi", "cheque", "cash", "credit_note", "other"]) }, { name: "payment_type", label: "Type", type: "select", options: options(["CUSTOMER_TO_DEALER", "DEALER_TO_FACTORY", "ADVANCE_PAYMENT", "PARTIAL_PAYMENT", "FINAL_PAYMENT", "REFUND", "ADJUSTMENT"]) }, { name: "payment_status", label: "Status", type: "select", options: options(["PENDING", "PAID", "PARTIALLY_PAID", "FAILED", "REFUNDED", "CANCELLED"]) }, { name: "reference_number", label: "Reference" }, { name: "notes", label: "Notes", type: "textarea" }]
  },
  expenses: {
    key: "expenses",
    title: "Expenses",
    databaseTitle: "Expenses Ledger",
    description: "Centralized company expense ledger linked to foundry, inventory, tooling, maintenance, and manual cost records.",
    table: "expense_ledger",
    select: "*, vendors(vendor_name), inventory_items(item_code, item_name), machines(machine_name)",
    basePath: "/expenses",
    resource: "financials",
    primaryAction: "Create Manual Expense",
    databaseAction: "View Expense Database",
    groupField: "approval_status",
    groups: ["draft", "pending_approval", "approved", "rejected", "paid", "cancelled", "reversed"],
    searchPlaceholder: "Search expense number, category, invoice, vendor, description...",
    searchFields: ["expense_number", "expense_category", "expense_subcategory", "invoice_number", "description", "source_module", "source_submodule", "source_label"],
    dateFilterField: "created_at",
    secondaryFilter: { field: "payment_status", label: "Payment Status", options: options(["unpaid", "partially_paid", "paid", "overdue", "cancelled", "reversed"]) },
    defaultSort: { column: "created_at", direction: "desc" },
    columns: [
      { id: "expense_number", header: "Expense No", path: "expense_number", sortable: true },
      { id: "created_at", header: "Date", path: "created_at", type: "date", sortable: true },
      { id: "expense_category", header: "Category", path: "expense_category", type: "badge", sortable: true },
      { id: "description", header: "Description", path: "description", sortable: true },
      { id: "vendor", header: "Vendor", path: "vendors.vendor_name" },
      { id: "source_module", header: "Source Module", path: "source_module", type: "badge", sortable: true },
      { id: "total_amount", header: "Amount", path: "total_amount", type: "currency", sortable: true },
      { id: "amount_paid", header: "Paid", path: "amount_paid", type: "currency", sortable: true },
      { id: "balance_amount", header: "Balance", path: "balance_amount", type: "currency", sortable: true },
      { id: "payment_status", header: "Payment", path: "payment_status", type: "badge", sortable: true },
      { id: "approval_status", header: "Approval", path: "approval_status", type: "badge", sortable: true }
    ],
    card: {
      titlePath: "expense_number",
      subtitlePath: "description",
      badgePath: "payment_status",
      meta: [
        { label: "Category", path: "expense_category", type: "badge" },
        { label: "Vendor", path: "vendors.vendor_name" },
        { label: "Total", path: "total_amount", type: "currency" },
        { label: "Balance", path: "balance_amount", type: "currency" }
      ]
    },
    schema: expenseLedgerSchema,
    defaultValues: {
      source_module: "manual",
      source_submodule: "manual_expense",
      source_table: "",
      source_record_id: "",
      source_label: "",
      expense_category: "office_and_administration",
      expense_subcategory: "miscellaneous",
      vendor_id: "",
      description: "",
      quantity: 1,
      unit: "nos",
      rate: 0,
      base_amount: 0,
      tax_amount: 0,
      freight_amount: 0,
      discount_amount: 0,
      total_amount: 0,
      currency: "INR",
      payment_status: "unpaid",
      payment_method: "",
      invoice_number: "",
      invoice_date: "",
      due_date: "",
      paid_date: "",
      cost_center: "",
      department: "",
      machine_id: "",
      inventory_item_id: "",
      maintenance_record_id: "",
      approval_status: "draft",
      notes: ""
    },
    fields: [
      { name: "source_module", label: "Source module", type: "select", options: options(["manual", "foundry", "inventory", "maintenance", "dies", "packaging", "utilities", "admin"]) },
      { name: "source_submodule", label: "Source submodule" },
      { name: "source_table", label: "Source table" },
      { name: "source_record_id", label: "Source record ID" },
      { name: "source_label", label: "Source label" },
      { name: "expense_category", label: "Category", type: "select", options: options(["raw_material", "scrap_purchase", "external_aluminium_source", "packaging_material", "spare_parts", "maintenance_repairs", "dies_tooling", "utilities", "fuel_oils", "chemicals", "freight_logistics", "labour_vendor_services", "office_and_administration", "production_consumables", "surface_treatment", "factory_overheads", "miscellaneous"]) },
      { name: "expense_subcategory", label: "Subcategory" },
      { name: "vendor_id", label: "Vendor", type: "select", lookup: vendorLookup },
      { name: "description", label: "Description", required: true, type: "textarea" },
      { name: "quantity", label: "Quantity", type: "number", step: "0.001" },
      { name: "unit", label: "Unit" },
      { name: "rate", label: "Rate", type: "number", step: "0.01" },
      { name: "base_amount", label: "Base amount", type: "number", step: "0.01" },
      { name: "tax_amount", label: "Tax amount", type: "number", step: "0.01" },
      { name: "freight_amount", label: "Freight amount", type: "number", step: "0.01" },
      { name: "discount_amount", label: "Discount amount", type: "number", step: "0.01" },
      { name: "total_amount", label: "Total amount", type: "number", step: "0.01" },
      { name: "currency", label: "Currency", type: "select", options: options(["INR", "USD", "EUR", "AED", "GBP", "other"]) },
      { name: "payment_status", label: "Payment status", type: "select", options: options(["unpaid", "partially_paid", "paid", "overdue", "cancelled", "reversed"]) },
      { name: "payment_method", label: "Payment method" },
      { name: "invoice_number", label: "Invoice number" },
      { name: "invoice_date", label: "Invoice date", type: "date" },
      { name: "due_date", label: "Due date", type: "date" },
      { name: "paid_date", label: "Paid date", type: "date" },
      { name: "cost_center", label: "Cost center" },
      { name: "department", label: "Department" },
      { name: "machine_id", label: "Machine", type: "select", lookup: { table: "machines", select: "id, machine_name", labelFields: ["machine_name"], orderBy: "machine_name" } },
      { name: "inventory_item_id", label: "Inventory item", type: "select", lookup: { table: "inventory_items", select: "id, item_code, item_name", labelFields: ["item_code", "item_name"], orderBy: "item_name" } },
      { name: "maintenance_record_id", label: "Maintenance record ID" },
      { name: "approval_status", label: "Approval status", type: "select", options: options(["draft", "pending_approval", "approved", "rejected", "paid", "cancelled", "reversed"]) },
      { name: "notes", label: "Notes", type: "textarea" }
    ],
    emptyState: { title: "No expenses posted", description: "Create manual expenses or post source transactions from foundry and inventory to build centralized spend visibility." },
    detailIntro: "Track one expense with source linkage, invoice details, payment trail, approvals, and cost attribution context.",
    detailSections: [
      { title: "Financial", fields: [{ label: "Category", path: "expense_category", type: "badge" }, { label: "Subcategory", path: "expense_subcategory" }, { label: "Base", path: "base_amount", type: "currency" }, { label: "Tax", path: "tax_amount", type: "currency" }, { label: "Freight", path: "freight_amount", type: "currency" }, { label: "Discount", path: "discount_amount", type: "currency" }, { label: "Total", path: "total_amount", type: "currency" }, { label: "Balance", path: "balance_amount", type: "currency" }] },
      { title: "Workflow", fields: [{ label: "Payment status", path: "payment_status", type: "badge" }, { label: "Approval status", path: "approval_status", type: "badge" }, { label: "Invoice number", path: "invoice_number" }, { label: "Invoice date", path: "invoice_date", type: "date" }, { label: "Due date", path: "due_date", type: "date" }, { label: "Paid date", path: "paid_date", type: "date" }] },
      { title: "Source Link", fields: [{ label: "Source module", path: "source_module", type: "badge" }, { label: "Source submodule", path: "source_submodule" }, { label: "Source table", path: "source_table" }, { label: "Source record", path: "source_record_id" }, { label: "Source label", path: "source_label" }] }
    ],
    relatedRecords: [
      { label: "Expense Payments", table: "expense_payments", field: "expense_ledger_id", href: "/expenses/payments/database", hint: "Payment entries posted against this expense" }
    ]
  },
  expense_payments: {
    key: "expense_payments",
    title: "Expense Payments",
    databaseTitle: "Expense Payments Ledger",
    description: "Capture supplier payments against expense entries, including method, reference, and posting date.",
    table: "expense_payments",
    select: "*, expense_ledger(expense_number, description, total_amount)",
    basePath: "/expenses/payments",
    resource: "financials",
    primaryAction: "Record Expense Payment",
    databaseAction: "View Expense Payments",
    searchPlaceholder: "Search payment reference, expense number, notes...",
    searchFields: ["reference_number", "notes"],
    dateFilterField: "payment_date",
    defaultSort: { column: "payment_date", direction: "desc" },
    columns: [
      { id: "payment_date", header: "Date", path: "payment_date", type: "date", sortable: true },
      { id: "expense", header: "Expense", path: "expense_ledger.expense_number" },
      { id: "description", header: "Description", path: "expense_ledger.description" },
      { id: "amount_paid", header: "Amount Paid", path: "amount_paid", type: "currency", sortable: true },
      { id: "payment_method", header: "Method", path: "payment_method", sortable: true },
      { id: "reference_number", header: "Reference", path: "reference_number", sortable: true }
    ],
    card: {
      titlePath: "expense_ledger.expense_number",
      subtitlePath: "reference_number",
      meta: [
        { label: "Date", path: "payment_date", type: "date" },
        { label: "Paid", path: "amount_paid", type: "currency" },
        { label: "Method", path: "payment_method" }
      ]
    },
    schema: expensePaymentSchema,
    defaultValues: {
      expense_ledger_id: "",
      payment_date: new Date().toISOString().slice(0, 10),
      amount_paid: 0,
      payment_method: "bank_transfer",
      bank_account: "",
      reference_number: "",
      notes: ""
    },
    fields: [
      { name: "expense_ledger_id", label: "Expense", type: "select", required: true, lookup: { table: "expense_ledger", select: "id, expense_number, description, payment_status", labelFields: ["expense_number", "description"], orderBy: "created_at" } },
      { name: "payment_date", label: "Payment date", type: "date", required: true },
      { name: "amount_paid", label: "Amount paid", type: "number", required: true, step: "0.01" },
      { name: "payment_method", label: "Payment method" },
      { name: "bank_account", label: "Bank account" },
      { name: "reference_number", label: "Reference number" },
      { name: "notes", label: "Notes", type: "textarea" }
    ]
  }
};

moduleConfigs.customers.searchPlaceholder = "Search name, company, contact, phone, WhatsApp, email, GST, city...";
moduleConfigs.customers.searchFields = ["customer_name", "company_name", "contact_person", "phone", "whatsapp_number", "email", "gst_number", "city", "state", "pincode", "billing_address", "shipping_address", "customer_type", "payment_terms", "notes"];

moduleConfigs.orders.uniqueField = "order_number";
moduleConfigs.orders.uniqueLabel = "Order number";
moduleConfigs.orders.emptyState = { title: "No active orders", description: "Create an order from an approved quotation or add a direct customer order with expected dispatch, priority, and value." };
moduleConfigs.orders.detailIntro = "Trace one order from customer commitment through material readiness, production, finishing, dispatch, and payment follow-up.";
moduleConfigs.orders.detailSections = [
  { title: "Commercial", fields: [{ label: "Customer", path: "customers.company_name" }, { label: "Linked quote", path: "quotes.quote_number" }, { label: "Order date", path: "order_date", type: "date" }, { label: "Order value", path: "order_value", type: "currency" }] },
  { title: "Source", fields: [{ label: "Origin", path: "order_origin", type: "badge" }, { label: "Source Label", path: "order_source_label" }] },
  { title: "Factory Flow", fields: [{ label: "Current stage", path: "current_stage", type: "badge" }, { label: "Priority", path: "priority", type: "badge" }, { label: "Expected dispatch", path: "expected_dispatch_date", type: "date" }, { label: "Notes", path: "notes" }] },
  { title: "Production Requirement", fields: [{ label: "Profile", path: "production_profile.profile_code" }, { label: "Die", path: "production_die.die_number" }, { label: "Required billet diameter inch", path: "billet_diameter_required_inch", type: "number" }, { label: "Billets required", path: "billets_required", type: "number" }, { label: "Billets allocated", path: "billets_allocated", type: "number" }, { label: "Billets short", path: "billets_short", type: "number" }, { label: "Billet status", path: "billet_allocation_status", type: "badge" }, { label: "Required kg", path: "production_quantity_kg", type: "weight" }, { label: "Pieces", path: "production_pieces", type: "number" }, { label: "Production notes", path: "production_notes" }] }
];
moduleConfigs.orders.relatedRecords = [
  { label: "Production Jobs", table: "production_jobs", field: "order_id", href: "/production/database", hint: "Extrusion jobs planned or running for this order" },
  { label: "Dispatches", table: "dispatches", field: "order_id", href: "/dispatches/database", hint: "Shipments, transporter details, and delivery status" },
  { label: "Invoices", table: "invoices", field: "order_id", href: "/invoices/database", hint: "Billing and payment traceability" }
];

moduleConfigs.quotes.emptyState = { title: "No quotations yet", description: "Create a quote with profile kg/m, finish, wastage, margin, GST, and customer terms before converting to order." };
moduleConfigs.quotes.detailIntro = "Review quote status, validity, value, approval risk, and customer before order conversion.";
moduleConfigs.quotes.detailSections = [
  { title: "Quote Control", fields: [{ label: "Customer", path: "customers.company_name" }, { label: "Status", path: "status", type: "badge" }, { label: "Quote date", path: "quote_date", type: "date" }, { label: "Valid until", path: "valid_until", type: "date" }] },
  { title: "Value", fields: [{ label: "Grand total", path: "grand_total", type: "currency" }, { label: "GST", path: "gst_amount", type: "currency" }, { label: "Estimated profit", path: "estimated_profit_amount", type: "currency" }, { label: "Revision", path: "revision_number", type: "number" }] }
];
moduleConfigs.quotes.relatedRecords = [{ label: "Orders", table: "orders", field: "quote_id", href: "/orders/database", hint: "Orders converted from this quotation" }];

moduleConfigs.dispatches.uniqueField = "dispatch_number";
moduleConfigs.dispatches.uniqueLabel = "Dispatch number";
moduleConfigs.dispatches.emptyState = { title: "No dispatches recorded", description: "Create dispatches only when material is packed and ready, with bundles, weight, transporter, LR, and e-way bill details." };
moduleConfigs.dispatches.detailIntro = "Track shipment identity, packed weight, transporter details, delivery status, and proof-of-delivery readiness.";
moduleConfigs.dispatches.detailSections = [
  { title: "Shipment", fields: [{ label: "Order", path: "orders.order_number" }, { label: "Customer", path: "orders.customers.company_name" }, { label: "Dispatch date", path: "dispatch_date", type: "date" }, { label: "Delivery status", path: "delivery_status", type: "badge" }] },
  { title: "Logistics", fields: [{ label: "Bundles", path: "number_of_bundles", type: "number" }, { label: "Weight", path: "total_weight_kg", type: "weight" }, { label: "Transporter", path: "transporter_name" }, { label: "Vehicle", path: "vehicle_number" }] }
];

moduleConfigs.production.uniqueField = "job_number";
moduleConfigs.production.uniqueLabel = "Job number";
moduleConfigs.production.emptyState = { title: "No production jobs planned", description: "Plan extrusion jobs from pending orders or stock requirements with profile, die, press, shift, and target kg." };
moduleConfigs.production.detailIntro = "Track one extrusion job by order, profile, die, machine, shift, target kg, actual output, and exceptions.";
moduleConfigs.production.detailSections = [
  { title: "Planning", fields: [{ label: "Order", path: "order.order_number" }, { label: "Profile", path: "profile.profile_code" }, { label: "Die", path: "die.die_number" }, { label: "Machine", path: "machine.machine_name" }] },
  { title: "Output", fields: [{ label: "Status", path: "status", type: "badge" }, { label: "Planned date", path: "planned_date", type: "date" }, { label: "Pieces", path: "pieces", type: "number" }, { label: "Planned kg", path: "planned_quantity_kg", type: "weight" }, { label: "Actual kg", path: "actual_quantity_kg", type: "weight" }] }
];
moduleConfigs.production.relatedRecords = [
  { label: "Quality Inspections", table: "quality_inspections", field: "production_job_id", href: "/quality/database", hint: "QC checks linked to this extrusion run" },
  { label: "Finishing Jobs", table: "finishing_jobs", field: "production_job_id", href: "/production/finishing", hint: "Powder coating/anodizing handoffs linked to this run" }
];

moduleConfigs.foundry.uniqueField = "batch_number";
moduleConfigs.foundry.uniqueLabel = "Foundry batch ID";
moduleConfigs.foundry.emptyState = { title: "No foundry batches", description: "Create a furnace batch to track scrap aluminium, ingot, alloy, temper, billet size, billet count, and calculated billet weight." };
moduleConfigs.foundry.detailIntro = "Track one furnace heat from scrap and ingot input through casting, homogenizing, and billet readiness.";
moduleConfigs.foundry.detailSections = [
  { title: "Foundry Run", fields: [{ label: "Batch ID", path: "batch_number" }, { label: "Furnace", path: "furnace_name" }, { label: "Production date", path: "production_date", type: "date" }, { label: "Status", path: "status", type: "badge" }] },
  { title: "Metal Input", fields: [{ label: "Scrap batch", path: "scrap_id" }, { label: "Scrap aluminium", path: "scrap_aluminium_kg", type: "weight" }, { label: "Ingot", path: "ingot_kg", type: "weight" }, { label: "Alloy", path: "alloy" }, { label: "Temper", path: "temper" }] },
  { title: "Billet Output", fields: [{ label: "Length mm", path: "billet_length_mm", type: "number" }, { label: "Diameter mm", path: "billet_diameter_mm", type: "number" }, { label: "Weight each", path: "billet_weight_kg", type: "weight" }, { label: "Total billet kg", path: "total_billet_weight_kg", type: "weight" }] }
];

moduleConfigs.inventory.uniqueField = "item_code";
moduleConfigs.inventory.uniqueLabel = "Item code";
moduleConfigs.inventory.emptyState = { title: "No inventory items", description: "Add billets, profile stock, hardware, packing material, scrap, or finished goods with unit, current stock, reorder level, and location." };
moduleConfigs.inventory.detailIntro = "Check stock health, reorder risk, item category, warehouse location, and movement traceability for one item.";
moduleConfigs.inventory.detailSections = [
  { title: "Stock", fields: [{ label: "Category", path: "item_category", type: "badge" }, { label: "Current stock", path: "current_stock", type: "number" }, { label: "Reorder level", path: "reorder_level", type: "number" }, { label: "Unit", path: "unit" }] },
  { title: "Commercial", fields: [{ label: "Average rate", path: "average_rate", type: "currency" }, { label: "Location", path: "location" }, { label: "Active", path: "is_active" }, { label: "Updated", path: "updated_at", type: "date" }] }
];

moduleConfigs.customers.emptyState = { title: "No customers added", description: "Add your first fabricator, dealer, architect, builder, contractor, or industrial customer with contact and GST details." };
moduleConfigs.customers.detailIntro = "See one customer’s contact readiness, type, addresses, GST information, and linked commercial activity.";
moduleConfigs.customers.detailSections = [
  { title: "Contact", fields: [{ label: "Company", path: "company_name" }, { label: "Contact person", path: "contact_person" }, { label: "Phone", path: "phone" }, { label: "WhatsApp", path: "whatsapp_number" }] },
  { title: "Business", fields: [{ label: "Type", path: "customer_type", type: "badge" }, { label: "GST", path: "gst_number" }, { label: "City", path: "city" }, { label: "Payment terms", path: "payment_terms" }] }
];
moduleConfigs.customers.relatedRecords = [
  { label: "Quotes", table: "quotes", field: "customer_id", href: "/quotes/database", hint: "Quotation pipeline and revisions" },
  { label: "Orders", table: "orders", field: "customer_id", href: "/orders/database", hint: "Confirmed sales and dispatch commitments" },
  { label: "Invoices", table: "invoices", field: "customer_id", href: "/invoices/database", hint: "Receivables and payment follow-up" }
];

moduleConfigs.profiles.uniqueField = "profile_code";
moduleConfigs.profiles.uniqueLabel = "Profile code";
moduleConfigs.profiles.emptyState = { title: "No profiles added", description: "Add profile master data with code, kg/m, alloy, temper, standard length, finish options, drawings, and usage notes." };
moduleConfigs.profiles.detailIntro = "Use this profile master record as the source for quotation, die, inventory, production, configurator, and BOM decisions.";
moduleConfigs.profiles.detailSections = [
  { title: "Technical", fields: [{ label: "Profile code", path: "profile_code" }, { label: "Category", path: "application_category", type: "badge" }, { label: "Section kg/m", path: "section_weight_kg_per_m", type: "weight" }, { label: "Standard length", path: "standard_length_m", type: "number" }, { label: "Billet diameter inch", path: "billet_diameter_required_inch", type: "number" }] },
  { title: "Specification", fields: [{ label: "Alloy", path: "alloy" }, { label: "Temper", path: "temper" }, { label: "Finish options", path: "finish_options" }, { label: "Active", path: "is_active" }] }
];
moduleConfigs.profiles.relatedRecords = [
  { label: "Dies", table: "dies", field: "profile_id", href: "/dies/database", hint: "Dies capable of extruding this profile" },
  { label: "Production Jobs", table: "production_jobs", field: "profile_id", href: "/production/database", hint: "Extrusion runs linked to this profile" }
];
moduleConfigs.profiles.description = "Manage aluminium profile master data by category, section weight, required billet diameter, alloy, temper, and finish options.";
moduleConfigs.profiles.columns.splice(4, 0, { id: "billet_diameter_required_inch", header: "Billet Dia", path: "billet_diameter_required_inch", type: "number", sortable: true });
moduleConfigs.profiles.card.meta.splice(1, 0, { label: "Billet dia", path: "billet_diameter_required_inch", type: "number" });
moduleConfigs.profiles.defaultValues = { ...moduleConfigs.profiles.defaultValues, billet_diameter_required_inch: "" };
moduleConfigs.profiles.fields?.splice(4, 0, { name: "billet_diameter_required_inch", label: "Required billet diameter inch", type: "number", step: "0.01" });

moduleConfigs.quality.emptyState = { title: "No quality inspections", description: "Record checks for dimensions, wall thickness, kg/m, surface finish, hardness, defects, and batch disposition." };
moduleConfigs.quality.detailIntro = "Review one QC result with profile, batch, inspector, surface condition, dimensional notes, and disposition.";
moduleConfigs.quality.detailSections = [
  { title: "Inspection", fields: [{ label: "Batch", path: "batch_number" }, { label: "Profile", path: "aluminium_profiles.profile_code" }, { label: "Status", path: "status", type: "badge" }, { label: "Inspector", path: "inspector_name" }] },
  { title: "Quality Result", fields: [{ label: "Checked kg", path: "quantity_checked_kg", type: "weight" }, { label: "Surface OK", path: "surface_finish_ok" }, { label: "Actual kg/m", path: "weight_per_meter_actual", type: "weight" }, { label: "Dimensional variance", path: "dimensional_variance" }] }
];

moduleConfigs.invoices.uniqueField = "invoice_number";
moduleConfigs.invoices.uniqueLabel = "Invoice number";
moduleConfigs.invoices.emptyState = { title: "No invoices or payments", description: "Create invoices against customers, orders, or dispatches to track due dates, paid amount, and overdue receivables." };
moduleConfigs.invoices.detailIntro = "Track billing value, due date, paid amount, balance due, and customer payment status.";
moduleConfigs.invoices.detailSections = [
  { title: "Billing", fields: [{ label: "Customer", path: "customers.company_name" }, { label: "Status", path: "status", type: "badge" }, { label: "Invoice date", path: "invoice_date", type: "date" }, { label: "Due date", path: "due_date", type: "date" }] },
  { title: "Receivable", fields: [{ label: "Subtotal", path: "subtotal", type: "currency" }, { label: "Tax", path: "tax_total", type: "currency" }, { label: "Grand total", path: "grand_total", type: "currency" }, { label: "Balance due", path: "balance_due", type: "currency" }] }
];
moduleConfigs.invoices.title = "Invoices";
moduleConfigs.invoices.databaseTitle = "Invoice Database";
moduleConfigs.invoices.databaseAction = "View Invoice Database";
moduleConfigs.invoices.description = "Create dispatch-backed invoices, monitor due dates, and follow each receivable through posted customer receipts.";
moduleConfigs.invoices.emptyState = {
  title: "No dispatch invoices",
  description: "Complete a packing list, then create one invoice for that packed dispatch. Proformas remain outside receivables."
};
// Financial values and statuses are written only by the invoice/payment RPCs.
// Keeping these generic mutation definitions disabled prevents a future route
// from accidentally reintroducing browser-owned totals or receipt statuses.
moduleConfigs.invoices.schema = undefined;
moduleConfigs.invoices.fields = undefined;
moduleConfigs.invoices.relatedRecords = [
  { label: "Customer Receipts", table: "payments", field: "invoice_id", href: "/payments/database", hint: "Posted and reversed receipts for this invoice" }
];
moduleConfigs.payments.title = "Customer Receipts";
moduleConfigs.payments.databaseTitle = "Customer Receipt Ledger";
moduleConfigs.payments.description = "Post immutable receipts against issued invoices and reverse mistakes with an audit reason.";
moduleConfigs.payments.primaryAction = "Record Customer Receipt";

moduleConfigs.vendors.emptyState = { title: "No vendors added", description: "Add billet suppliers, die makers, finishing vendors, hardware suppliers, transporters, and packing suppliers." };
moduleConfigs.vendors.detailIntro = "Review one supplier’s category, contact readiness, GST details, service notes, and procurement suitability.";
moduleConfigs.vendors.detailSections = [
  { title: "Vendor", fields: [{ label: "Category", path: "vendor_type", type: "badge" }, { label: "Contact", path: "contact_person" }, { label: "Phone", path: "phone" }, { label: "Email", path: "email" }] },
  { title: "Business", fields: [{ label: "GST", path: "gst_number" }, { label: "City", path: "city" }, { label: "State", path: "state" }, { label: "Payment terms", path: "payment_terms" }] }
];

export function getModuleConfig(key: ModuleKey) {
  return moduleConfigs[key];
}
