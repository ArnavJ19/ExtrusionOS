// AP-006 / AP-007: what each go-live sheet holds. One definition per master (customers, vendors, transporters,
// profiles, dies, machines) and per cut-over opening section. Field parsers never turn an unreadable cell into zero:
// a blank optional cell stays blank, and an unreadable cell is an error on that row.
import { resolveGstRegistration } from "../../validations/gstin.ts";

export type FieldKind = "text" | "number" | "integer" | "date" | "enum" | "phone" | "email" | "pincode" | "gstin" | "registration";
export type ImportField = {
  key: string; label: string; required?: boolean; kind: FieldKind; synonyms?: string[]; max?: number; min?: number; positive?: boolean;
  options?: Record<string, string>; defaultValue?: string; hint?: string; upper?: boolean;
};
export type ImportDefinition = { key: string; label: string; description: string; fields: ImportField[]; controls?: { quantity?: string; amount?: string } };

const CUSTOMER_TYPES = { fabricator: "Fabricator", dealer: "Dealer", architect: "Architect", industrial: "Industrial", solar: "Solar", government: "Government", export: "Export", contractor: "Contractor", other: "Other" };
const VENDOR_TYPES = { aluminum_ingot: "Aluminium ingot", aluminum_sows: "Aluminium sows", aluminum_billets: "Aluminium billets", aluminum_wire_rods: "Wire rods", aluminum_t_ingots: "T-ingots",
  aluminum_chips: "Chips", die_maker: "Die maker", powder_coating: "Powder coating", anodizing: "Anodizing", hardware_supplier: "Hardware supplier", transporter: "Transporter",
  packing_supplier: "Packing supplier", maintenance: "Maintenance", other: "Other" };
const APPLICATIONS = { sliding_window: "Sliding window", casement_window: "Casement window", door: "Door", curtain_wall: "Curtain wall", partition: "Partition", railing: "Railing", solar: "Solar",
  heat_sink: "Heat sink", industrial: "Industrial", electrical: "Electrical", automotive: "Automotive", aerospace: "Aerospace", furniture: "Furniture", custom: "Custom", other: "Other" };
const OWNERSHIP = { company_owned: "Company owned", customer_owned: "Customer owned", shared: "Shared", trial: "Trial" };
const DIE_STATUS = { active: "Active", approved: "Approved", under_trial: "Under trial", under_correction: "Under correction", nitriding: "Nitriding", under_maintenance: "Under maintenance",
  blocked: "Blocked", inactive: "Inactive", retired: "Retired" };
const DIE_TYPES = { solid: "Solid", hollow: "Hollow", semi_hollow: "Semi hollow", porthole: "Porthole", bridge: "Bridge", feeder: "Feeder", multi_cavity: "Multi cavity", flat: "Flat", special: "Special" };
const MACHINE_TYPES = { extrusion_press: "Extrusion press", aging_oven: "Ageing oven", powder_coating_line: "Powder coating line", anodizing_line: "Anodizing line", cutting_machine: "Cutting machine",
  packing_station: "Packing station", other: "Other" };
const MACHINE_STATUS = { active: "Active", idle: "Idle", maintenance: "Maintenance", breakdown: "Breakdown", inactive: "Inactive" };
const ITEM_CATEGORIES = { packing_material: "Packing material", hardware: "Hardware", powder_coating_material: "Powder coating material", scrap: "Scrap", finished_goods: "Finished goods" };
const CUSTODY = { nitriding: "Nitriding", under_correction: "Under correction", under_maintenance: "Under maintenance" };
const REGISTRATION = { registered: "Registered", unregistered: "Unregistered" };

const party = (nameKey: "customer_name" | "vendor_name", nameLabel: string, nameSynonyms: string[]): ImportField[] => [
  { key: nameKey, label: nameLabel, required: true, kind: "text", max: 160, synonyms: nameSynonyms },
  { key: "gst_number", label: "GSTIN", kind: "gstin", synonyms: ["gst", "gst no", "gst number", "gstin no", "gstin number"] },
  { key: "gst_registration", label: "GST registration", kind: "registration", options: REGISTRATION, synonyms: ["registration", "gst status", "gst type"],
    hint: "Registered or Unregistered. Leave blank when a valid GSTIN is given." },
  { key: "contact_person", label: "Contact person", kind: "text", max: 120, synonyms: ["contact", "contact name"] },
  { key: "phone", label: "Phone", kind: "phone", synonyms: ["mobile", "phone no", "mobile no", "contact no"] },
  { key: "email", label: "Email", kind: "email", synonyms: ["e-mail", "mail"] },
  { key: "city", label: "City", kind: "text", max: 80, synonyms: ["town", "location"] },
  { key: "state", label: "State", kind: "text", max: 80, hint: "Filled from the GSTIN when blank." },
  { key: "payment_terms", label: "Payment terms", kind: "text", max: 200, synonyms: ["terms", "credit days"] },
  { key: "notes", label: "Notes", kind: "text", max: 1000, synonyms: ["remarks", "remark"] }
];

export const MASTER_DEFINITIONS: Record<string, ImportDefinition> = {
  customers: { key: "customers", label: "Customers", description: "Fabricators, dealers and project customers with GSTIN and address.", fields: [
    ...party("customer_name", "Customer name", ["customer", "party", "party name", "name", "customer name"]).slice(0, 2),
    { key: "company_name", label: "Company name", kind: "text", max: 160, synonyms: ["firm", "firm name", "company"] },
    { key: "customer_type", label: "Customer type", kind: "enum", options: CUSTOMER_TYPES, defaultValue: "other", synonyms: ["type", "category"] },
    ...party("customer_name", "Customer name", []).slice(2),
    { key: "whatsapp_number", label: "WhatsApp number", kind: "phone", synonyms: ["whatsapp", "whatsapp no"] },
    { key: "billing_address", label: "Billing address", kind: "text", max: 500, synonyms: ["address", "bill to"] },
    { key: "shipping_address", label: "Shipping address", kind: "text", max: 500, synonyms: ["ship to", "delivery address"] },
    { key: "pincode", label: "PIN code", kind: "pincode", synonyms: ["pin", "pin code", "postal code"] },
    { key: "credit_terms", label: "Credit terms", kind: "text", max: 200 }
  ] },
  vendors: { key: "vendors", label: "Vendors", description: "Billet suppliers, die makers, coaters, anodisers and other suppliers.", fields: [
    ...party("vendor_name", "Vendor name", ["vendor", "supplier", "supplier name", "name", "vendor name"]).slice(0, 2),
    { key: "vendor_type", label: "Vendor type", kind: "enum", options: VENDOR_TYPES, defaultValue: "other", synonyms: ["type", "category", "supplier type"] },
    ...party("vendor_name", "Vendor name", []).slice(2),
    { key: "address", label: "Address", kind: "text", max: 500 }
  ] },
  transporters: { key: "transporters", label: "Transporters", description: "Transport companies used for dispatch (stored as vendors of type transporter).", fields: [
    ...party("vendor_name", "Transporter name", ["transporter", "transporter name", "transport", "name"]).slice(0, 2),
    ...party("vendor_name", "Transporter name", []).slice(2)
  ] },
  profiles: { key: "profiles", label: "Profiles", description: "Section codes with section weight (kg/m), alloy and temper.", fields: [
    { key: "profile_code", label: "Profile code", required: true, kind: "text", max: 60, upper: true, synonyms: ["code", "section code", "section no", "die section", "item code"] },
    { key: "profile_name", label: "Profile name", required: true, kind: "text", max: 160, synonyms: ["name", "description", "section name"] },
    { key: "section_weight_kg_per_m", label: "Section weight kg/m", required: true, kind: "number", positive: true, max: 100, synonyms: ["kg/m", "weight", "wt/m", "kg per m", "weight kg/m", "section weight"] },
    { key: "application_category", label: "Application", kind: "enum", options: APPLICATIONS, defaultValue: "other", synonyms: ["category", "application category", "system"] },
    { key: "alloy", label: "Alloy", kind: "text", max: 20 },
    { key: "temper", label: "Temper", kind: "text", max: 20 },
    { key: "standard_length_m", label: "Standard length (m)", kind: "number", positive: true, max: 20, synonyms: ["length", "stock length", "standard length"] },
    { key: "section_perimeter_mm", label: "Perimeter (mm)", kind: "number", positive: true, max: 100000, synonyms: ["perimeter"] },
    { key: "pieces_per_bundle", label: "Pieces per bundle", kind: "integer", positive: true, max: 10000, synonyms: ["pcs per bundle", "bundle pcs"] },
    { key: "hsn_code", label: "HSN code", kind: "text", max: 12, synonyms: ["hsn"] },
    { key: "notes", label: "Notes", kind: "text", max: 1000, synonyms: ["remarks"] }
  ] },
  dies: { key: "dies", label: "Dies", description: "Die numbers linked to an existing profile code, with ownership and opening counters.", fields: [
    { key: "die_number", label: "Die number", required: true, kind: "text", max: 60, upper: true, synonyms: ["die no", "die", "die code"] },
    { key: "profile_code", label: "Profile code", required: true, kind: "text", max: 60, upper: true, synonyms: ["section code", "profile", "section no"] },
    { key: "customer_name", label: "Customer (for customer dies)", kind: "text", max: 160, synonyms: ["customer", "owner customer"] },
    { key: "ownership_type", label: "Ownership", kind: "enum", options: OWNERSHIP, defaultValue: "company_owned", synonyms: ["owner", "ownership type"] },
    { key: "die_status", label: "Die status", kind: "enum", options: DIE_STATUS, defaultValue: "active", synonyms: ["status"] },
    { key: "die_type", label: "Die type", kind: "enum", options: DIE_TYPES, synonyms: ["type"] },
    { key: "number_of_cavities", label: "Cavities", kind: "integer", positive: true, max: 50, synonyms: ["cavity", "no of cavities"] },
    { key: "rack_location", label: "Rack location", kind: "text", max: 120, synonyms: ["rack", "location"] },
    { key: "die_manufacturer", label: "Die maker", kind: "text", max: 120, synonyms: ["manufacturer", "maker"] },
    { key: "purchase_date", label: "Purchase date", kind: "date", synonyms: ["date of purchase", "received date"] },
    { key: "opening_production_kg", label: "Opening production kg", kind: "number", max: 100000000, synonyms: ["total kg", "production kg"] },
    { key: "opening_runs", label: "Opening runs", kind: "integer", max: 1000000, synonyms: ["runs", "total runs"] },
    { key: "notes", label: "Notes", kind: "text", max: 1000, synonyms: ["remarks"] }
  ] },
  machines: { key: "machines", label: "Machines", description: "Presses, ovens, coating and anodising lines, saws and packing stations.", fields: [
    { key: "machine_name", label: "Machine name", required: true, kind: "text", max: 120, synonyms: ["machine", "name"] },
    { key: "machine_type", label: "Machine type", required: true, kind: "enum", options: MACHINE_TYPES, synonyms: ["type"] },
    { key: "factory_code", label: "Factory code", kind: "text", max: 40, synonyms: ["code", "machine code", "machine no"], hint: "Kept in notes; ExtrusionOS numbers machines itself." },
    { key: "press_capacity_ton", label: "Press capacity (ton)", kind: "number", positive: true, max: 20000, synonyms: ["capacity", "tonnage", "ton"] },
    { key: "status", label: "Status", kind: "enum", options: MACHINE_STATUS, defaultValue: "active" },
    { key: "location", label: "Location", kind: "text", max: 120, synonyms: ["bay", "shed"] },
    { key: "manufacturer", label: "Manufacturer", kind: "text", max: 120, synonyms: ["make"] },
    { key: "purchase_date", label: "Purchase date", kind: "date" },
    { key: "notes", label: "Notes", kind: "text", max: 1000, synonyms: ["remarks"] }
  ] }
};

export const CUTOVER_DEFINITIONS: Record<string, ImportDefinition> = {
  profile_stock: { key: "profile_stock", label: "Finished profile stock", description: "Bundles on hand by profile, finish, length, pieces and weight.", controls: { quantity: "Total kg" }, fields: [
    { key: "profile_code", label: "Profile code", required: true, kind: "text", max: 60, upper: true, synonyms: ["section code", "code", "profile"] },
    { key: "finish", label: "Finish", kind: "text", max: 40, synonyms: ["finish type", "surface"] },
    { key: "piece_length_m", label: "Piece length (m)", required: true, kind: "number", positive: true, max: 20, synonyms: ["length", "cut length", "length m"] },
    { key: "pieces", label: "Pieces", required: true, kind: "integer", positive: true, max: 1000000, synonyms: ["pcs", "qty pcs", "nos"] },
    { key: "weight_kg", label: "Weight (kg)", required: true, kind: "number", positive: true, max: 10000000, synonyms: ["kg", "weight", "net weight"] },
    { key: "location", label: "Location", kind: "text", max: 120, synonyms: ["rack", "bin"] },
    { key: "bundle_number", label: "Bundle number", kind: "text", max: 60, synonyms: ["bundle", "bundle no"] },
    { key: "alloy", label: "Alloy", kind: "text", max: 20 }, { key: "temper", label: "Temper", kind: "text", max: 20 }
  ] },
  billet_stock: { key: "billet_stock", label: "Billet stock", description: "Billet batches on hand by alloy and weight.", controls: { quantity: "Total kg" }, fields: [
    { key: "batch_number", label: "Batch number", required: true, kind: "text", max: 60, upper: true, synonyms: ["batch", "lot", "batch no"] },
    { key: "alloy", label: "Alloy", kind: "text", max: 20 }, { key: "temper", label: "Temper", kind: "text", max: 20 },
    { key: "diameter_mm", label: "Diameter (mm)", kind: "number", positive: true, max: 2000, synonyms: ["dia", "diameter"] },
    { key: "length_mm", label: "Length (mm)", kind: "number", positive: true, max: 20000, synonyms: ["length"] },
    { key: "weight_kg", label: "Weight (kg)", required: true, kind: "number", positive: true, max: 100000000, synonyms: ["kg", "weight"] },
    { key: "heat_number", label: "Heat number", kind: "text", max: 60, synonyms: ["heat", "heat no"] }
  ] },
  consumable_stock: { key: "consumable_stock", label: "Stores and consumables", description: "Packing, hardware and coating material on hand.", controls: { quantity: "Total quantity", amount: "Total value (₹)" }, fields: [
    { key: "item_code", label: "Item code", required: true, kind: "text", max: 60, upper: true, synonyms: ["code"] },
    { key: "item_name", label: "Item name", required: true, kind: "text", max: 160, synonyms: ["name", "description", "item"] },
    { key: "category", label: "Category", kind: "enum", options: ITEM_CATEGORIES, defaultValue: "packing_material" },
    { key: "unit", label: "Unit", kind: "text", max: 20, synonyms: ["uom"] },
    { key: "quantity", label: "Quantity", required: true, kind: "number", positive: true, max: 100000000, synonyms: ["qty", "stock"] },
    { key: "rate", label: "Rate (₹)", kind: "number", max: 100000000, synonyms: ["price", "average rate"] },
    { key: "reorder_level", label: "Reorder level", kind: "number", max: 100000000, synonyms: ["minimum", "min stock"] },
    { key: "location", label: "Location", kind: "text", max: 120 }
  ] },
  receivables: { key: "receivables", label: "Outstanding receivables", description: "Each unpaid customer invoice with its balance.", controls: { amount: "Total outstanding (₹)" }, fields: [
    { key: "customer", label: "Customer (name or GSTIN)", required: true, kind: "text", max: 160, synonyms: ["customer name", "party", "party name"] },
    { key: "invoice_ref", label: "Invoice number", required: true, kind: "text", max: 40, synonyms: ["invoice", "bill no", "invoice no", "ref"] },
    { key: "invoice_date", label: "Invoice date", required: true, kind: "date", synonyms: ["date", "bill date"] },
    { key: "due_date", label: "Due date", kind: "date", synonyms: ["due"] },
    { key: "outstanding_amount", label: "Outstanding (₹)", required: true, kind: "number", positive: true, max: 1000000000, synonyms: ["balance", "outstanding", "amount due", "pending"] }
  ] },
  payables: { key: "payables", label: "Outstanding payables", description: "Each unpaid supplier bill with its balance.", controls: { amount: "Total outstanding (₹)" }, fields: [
    { key: "vendor", label: "Vendor (name or GSTIN)", required: true, kind: "text", max: 160, synonyms: ["supplier", "vendor name", "party"] },
    { key: "bill_ref", label: "Bill number", required: true, kind: "text", max: 40, synonyms: ["bill", "invoice no", "bill no"] },
    { key: "bill_date", label: "Bill date", required: true, kind: "date", synonyms: ["date", "invoice date"] },
    { key: "due_date", label: "Due date", kind: "date" },
    { key: "outstanding_amount", label: "Outstanding (₹)", required: true, kind: "number", positive: true, max: 1000000000, synonyms: ["balance", "outstanding", "amount due"] }
  ] },
  open_orders: { key: "open_orders", label: "Open orders", description: "Each open order line with the balance still to make or dispatch.", controls: { quantity: "Total balance kg" }, fields: [
    { key: "customer", label: "Customer (name or GSTIN)", required: true, kind: "text", max: 160, synonyms: ["party", "customer name"] },
    { key: "order_ref", label: "Customer order number", required: true, kind: "text", max: 60, synonyms: ["po", "po no", "order no", "order"] },
    { key: "order_date", label: "Order date", kind: "date" }, { key: "due_date", label: "Due date", kind: "date", synonyms: ["delivery date"] },
    { key: "profile_code", label: "Profile code", required: true, kind: "text", max: 60, upper: true, synonyms: ["section code", "profile"] },
    { key: "finish", label: "Finish", kind: "text", max: 40 },
    { key: "balance_pieces", label: "Balance pieces", kind: "integer", positive: true, max: 10000000, synonyms: ["pending pcs", "balance pcs"] },
    { key: "balance_kg", label: "Balance kg", required: true, kind: "number", positive: true, max: 100000000, synonyms: ["pending kg", "balance", "kg"] },
    { key: "rate_per_kg", label: "Rate per kg (₹)", kind: "number", positive: true, max: 100000, synonyms: ["rate"] }
  ] },
  die_custody: { key: "die_custody", label: "Dies at vendors", description: "Dies out for nitriding, correction or maintenance at cut-over.", fields: [
    { key: "die_number", label: "Die number", required: true, kind: "text", max: 60, upper: true, synonyms: ["die", "die no"] },
    { key: "custodian", label: "Vendor holding the die", required: true, kind: "text", max: 160, synonyms: ["vendor", "at", "with"] },
    { key: "custody_status", label: "Reason", required: true, kind: "enum", options: CUSTODY, synonyms: ["status", "purpose"] },
    { key: "since_date", label: "Since", kind: "date", synonyms: ["sent on", "date"] },
    { key: "reference", label: "Challan / reference", kind: "text", max: 60, synonyms: ["challan", "dc no"] }
  ] }
};

export const MASTER_KEYS = ["customers", "vendors", "transporters", "profiles", "dies", "machines"] as const;
export type MasterKey = (typeof MASTER_KEYS)[number];
export const CUTOVER_SECTION_KEYS = ["profile_stock", "billet_stock", "consumable_stock", "receivables", "payables", "open_orders", "die_custody"] as const;
export type CutoverSectionKey = (typeof CUTOVER_SECTION_KEYS)[number];

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function isoDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date.toISOString().slice(0, 10) : null;
}

/** Indian sheets write dates as DD/MM/YYYY; Excel may store them as day serial numbers. Ambiguous text is refused. */
export function parseSheetDate(value: string): string | null {
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) { const [y, m, d] = text.split("-").map(Number); return isoDate(y, m, d); }
  let match = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (match) { const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]); return isoDate(year, Number(match[2]), Number(match[1])); }
  match = text.match(/^(\d{1,2})[ -]([A-Za-z]{3})[A-Za-z]*[ -,]*(\d{4})$/);
  if (match && MONTHS[match[2].toLowerCase()]) return isoDate(Number(match[3]), MONTHS[match[2].toLowerCase()], Number(match[1]));
  if (/^\d{5}(\.\d+)?$/.test(text)) {
    const serial = Math.floor(Number(text));
    if (serial > 20000 && serial < 80000) return new Date(Date.UTC(1899, 11, 30) + serial * 86400000).toISOString().slice(0, 10);
  }
  return null;
}

/** Numbers as typed in Indian sheets: 1,20,000.50 and ₹ signs are accepted; anything else is unreadable (not zero). */
export function parseSheetNumber(value: string): number | null {
  const text = value.trim().replace(/^₹\s*/, "").replace(/^rs\.?\s*/i, "").replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeOption(value: string, options: Record<string, string>) {
  const plain = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (Object.hasOwn(options, plain)) return plain;
  const byLabel = Object.entries(options).find(([, label]) => label.toLowerCase() === value.trim().toLowerCase());
  return byLabel?.[0] ?? null;
}

export type ParsedRow = { ok: true; values: Record<string, string | number | null> } | { ok: false; errors: string[] };

export function parseRow(definition: ImportDefinition, record: Record<string, string>): ParsedRow {
  const values: Record<string, string | number | null> = {};
  const errors: string[] = [];
  for (const field of definition.fields) {
    const raw = (record[field.key] ?? "").trim();
    if (!raw) {
      if (field.required) errors.push(`${field.label} is missing`);
      values[field.key] = field.defaultValue ?? null;
      continue;
    }
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(raw)) { errors.push(`${field.label} has control characters`); continue; }
    if (field.kind === "text") {
      if (raw.length > (field.max ?? 200)) errors.push(`${field.label} is longer than ${field.max ?? 200} characters`);
      values[field.key] = field.upper ? raw.toUpperCase() : raw;
    } else if (field.kind === "number" || field.kind === "integer") {
      const parsed = parseSheetNumber(raw);
      if (parsed === null) errors.push(`${field.label} "${raw.slice(0, 20)}" is not a number`);
      else if (field.kind === "integer" && !Number.isInteger(parsed)) errors.push(`${field.label} must be a whole number`);
      else if (field.positive && parsed <= 0) errors.push(`${field.label} must be above zero`);
      else if (parsed < 0) errors.push(`${field.label} cannot be negative`);
      else if (field.max !== undefined && parsed > field.max) errors.push(`${field.label} is above ${field.max.toLocaleString("en-IN")}`);
      else values[field.key] = parsed;
    } else if (field.kind === "date") {
      const parsed = parseSheetDate(raw);
      if (!parsed) errors.push(`${field.label} "${raw.slice(0, 20)}" is not a date (use DD/MM/YYYY)`);
      else values[field.key] = parsed;
    } else if (field.kind === "enum" || field.kind === "registration") {
      const parsed = normalizeOption(raw, field.options ?? {});
      if (!parsed) errors.push(`${field.label} "${raw.slice(0, 30)}" is not one of: ${Object.values(field.options ?? {}).join(", ")}`);
      else values[field.key] = parsed;
    } else if (field.kind === "phone") {
      const digits = raw.replace(/\D/g, "");
      const national = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits.length === 11 && digits.startsWith("0") ? digits.slice(1) : digits;
      if (!/^[6-9]\d{9}$/.test(national)) errors.push(`${field.label} "${raw.slice(0, 20)}" is not an Indian mobile or phone number`);
      else values[field.key] = national;
    } else if (field.kind === "email") {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) || raw.length > 160) errors.push(`${field.label} is not a valid email`);
      else values[field.key] = raw.toLowerCase();
    } else if (field.kind === "pincode") {
      if (!/^[1-9]\d{5}$/.test(raw)) errors.push(`${field.label} must be six digits`);
      else values[field.key] = raw;
    } else if (field.kind === "gstin") {
      values[field.key] = raw;
    }
  }
  if (definition.fields.some(field => field.kind === "registration")) {
    const gst = resolveGstRegistration({ gst_number: values.gst_number as string | null, gst_registration: values.gst_registration as string | null });
    if (!gst.ok) errors.push(gst.message);
    else {
      values.gst_number = gst.gst_number; values.gst_registration = gst.gst_registration;
      if (!values.state && gst.state) values.state = gst.state;
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, values };
}
