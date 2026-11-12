// AP-081: e-way bill bulk-upload file. The database supplies the facts of each dispatch (private.ap4_eway_source);
// this module validates them and maps them to the NIC portal's bulk generation JSON. Nothing is sent anywhere: a person
// uploads the file on the portal and pastes the generated EWB numbers back. No portal credentials are stored.
import { checkGstin } from "../validations/gstin.ts";

/** Recorded with every export. The field layout follows the NIC bulk-generation JSON (version 1.0.0621); confirm it
 *  against the portal's current tool on the first upload, and change this constant if the portal changes. */
export const EWAY_SCHEMA_VERSION = "NIC-EWB-BULK-1.0.0621";
const NIC_JSON_VERSION = "1.0.0621";

export type EwaySource = {
  dispatch_id: string; dispatch_number: string; dispatch_date: string; activated: boolean; vehicle_number: string | null; transporter_name: string | null; lr_number: string | null;
  eway_bill_number: string | null;
  supplier: { gstin: string | null; name: string | null; address: string | null; place: string | null; pincode: string | null; state_code: string | null };
  recipient: { gstin: string | null; name: string | null; address: string | null; place: string | null; pincode: string | null; state_code: string | null };
  invoice: null | { id: string; number: string; date: string; subtotal: number; cgst: number; sgst: number; igst: number; total: number; other_value: number;
    items: { hsn: string | null; description: string; quantity_kg: number; taxable: number; gst_percent: number }[] };
  inputs: { distance_km: number | null; distance_saved: boolean; transport_mode: "road" | "rail" | "air" | "ship"; vehicle_type: "regular" | "over_dimensional"; transporter_gstin: string | null };
};

export type EwayIssue = { field: string; message: string };
const VEHICLE = /^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$|^TM[0-9]{6}$|^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$/;
const MODES = { road: 1, rail: 2, air: 3, ship: 4 } as const;

const ddmmyyyy = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split("-"); return `${d}/${m}/${y}`; };
const money = (value: number) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const clean = (value: string | null | undefined, max: number) => String(value ?? "").replace(/[\u0000-\u001f\u007f"\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

export function validateEwaySource(source: EwaySource): EwayIssue[] {
  const issues: EwayIssue[] = [];
  const add = (field: string, message: string) => issues.push({ field, message });
  if (!source.activated) add("dispatch", "The dispatch is not loaded yet.");
  if (source.eway_bill_number) add("dispatch", `The dispatch already has e-way bill ${source.eway_bill_number}.`);
  if (!source.invoice) add("invoice", "Post the invoice for this dispatch first (Invoices → Drafts); the e-way bill is generated against it.");
  const supplier = checkGstin(source.supplier.gstin);
  if (!supplier.valid) add("supplier.gstin", "Omalco's GSTIN is missing or invalid in company settings.");
  if (!/^[1-9][0-9]{5}$/.test(source.supplier.pincode ?? "")) add("supplier.pincode", "Omalco's PIN code is missing in company settings.");
  if (!clean(source.supplier.place, 50)) add("supplier.place", "Omalco's city is missing in company settings.");
  if (!/^[0-9]{2}$/.test(source.supplier.state_code ?? "")) add("supplier.state", "Omalco's GST state code is missing.");
  if (source.recipient.gstin && !checkGstin(source.recipient.gstin).valid) add("recipient.gstin", "The customer's GSTIN is invalid; correct it on the customer record.");
  if (!/^[1-9][0-9]{5}$/.test(source.recipient.pincode ?? "")) add("recipient.pincode", "The customer's PIN code is missing on the customer record.");
  if (!clean(source.recipient.place, 50)) add("recipient.place", "The customer's city is missing on the customer record.");
  if (!/^[0-9]{2}$/.test(source.recipient.state_code ?? "")) add("recipient.state", "The place of supply is unknown; record the customer's GSTIN or state.");
  const distance = source.inputs.distance_km;
  if (distance === null || !Number.isInteger(distance) || distance < 0 || distance > 4000) add("distance", "Enter the approximate distance in km (0–4000).");
  if (source.inputs.transport_mode === "road" && !VEHICLE.test(source.vehicle_number ?? "")) add("vehicle", "Record a valid vehicle number (for example MH12AB1234) on the dispatch.");
  if (source.inputs.transporter_gstin && !/^[0-9A-Z]{15}$/.test(source.inputs.transporter_gstin)) add("transporter", "The transporter ID must have 15 characters.");
  if (source.invoice) {
    if ((source.invoice.number ?? "").length > 16) add("invoice", "The invoice number is longer than the 16 characters the portal accepts.");
    if (!source.invoice.items.length) add("items", "The invoice has no goods lines.");
    for (const item of source.invoice.items) if (!/^(\d{4}|\d{6}|\d{8})$/.test(item.hsn ?? "")) add("items", `Goods line "${item.description}" has no 4, 6 or 8-digit HSN code.`);
    if (!(Number(source.invoice.total) > 0)) add("invoice", "The invoice value must be above zero.");
  }
  return issues;
}

type BillItem = { itemNo: number; productName: string; productDesc: string; hsnCode: number; quantity: number; qtyUnit: "KGS"; taxableAmount: number;
  sgstRate: number; cgstRate: number; igstRate: number; cessRate: number; cessNonAdvol: number };

export function buildEwayBill(source: EwaySource) {
  const invoice = source.invoice!;
  const interstate = Number(invoice.igst) > 0 || source.supplier.state_code !== source.recipient.state_code;
  const items: BillItem[] = invoice.items.map((item, index) => ({
    itemNo: index + 1, productName: clean(item.description, 100) || "Aluminium extrusions", productDesc: clean(item.description, 100) || "Aluminium extrusions",
    hsnCode: Number(item.hsn), quantity: Math.round(Number(item.quantity_kg) * 1000) / 1000, qtyUnit: "KGS", taxableAmount: money(item.taxable),
    sgstRate: interstate ? 0 : Number(item.gst_percent) / 2, cgstRate: interstate ? 0 : Number(item.gst_percent) / 2, igstRate: interstate ? Number(item.gst_percent) : 0, cessRate: 0, cessNonAdvol: 0
  }));
  const main = [...invoice.items].sort((a, b) => Number(b.taxable) - Number(a.taxable))[0];
  return {
    userGstin: source.supplier.gstin!, supplyType: "O", subSupplyType: 1, subSupplyDesc: "", docType: "INV", docNo: invoice.number, docDate: ddmmyyyy(invoice.date), transType: 1,
    fromGstin: source.supplier.gstin!, fromTrdName: clean(source.supplier.name, 100), fromAddr1: clean(source.supplier.address, 120), fromAddr2: "", fromPlace: clean(source.supplier.place, 50),
    fromPincode: Number(source.supplier.pincode), fromStateCode: Number(source.supplier.state_code), actualFromStateCode: Number(source.supplier.state_code),
    toGstin: source.recipient.gstin ?? "URP", toTrdName: clean(source.recipient.name, 100), toAddr1: clean(source.recipient.address, 120), toAddr2: "", toPlace: clean(source.recipient.place, 50),
    toPincode: Number(source.recipient.pincode), toStateCode: Number(source.recipient.state_code), actualToStateCode: Number(source.recipient.state_code),
    totalValue: money(items.reduce((sum, item) => sum + item.taxableAmount, 0)), cgstValue: money(invoice.cgst), sgstValue: money(invoice.sgst), igstValue: money(invoice.igst), cessValue: 0,
    TotNonAdvolVal: 0, OthValue: money(invoice.other_value), totInvValue: money(invoice.total),
    transMode: MODES[source.inputs.transport_mode], transDistance: source.inputs.distance_km ?? 0, transporterName: clean(source.transporter_name, 100),
    transporterId: source.inputs.transporter_gstin ?? "", transDocNo: source.inputs.transport_mode === "road" ? "" : clean(source.lr_number, 15), transDocDate: "",
    vehicleNo: source.inputs.transport_mode === "road" ? source.vehicle_number ?? "" : "", vehicleType: source.inputs.vehicle_type === "over_dimensional" ? "O" : "R",
    mainHsnCode: Number(main?.hsn ?? 0), itemList: items
  };
}

export type EwayExport = { file: { version: string; billLists: ReturnType<typeof buildEwayBill>[] }; included: EwaySource[]; skipped: { source: EwaySource; issues: EwayIssue[] }[] };

/** Valid sources go into one file; invalid ones are listed with what to fix (never exported half-filled). */
export function buildEwayExport(sources: EwaySource[]): EwayExport {
  const included: EwaySource[] = [], skipped: EwayExport["skipped"] = [];
  for (const source of sources) {
    const issues = validateEwaySource(source);
    if (issues.length) skipped.push({ source, issues }); else included.push(source);
  }
  return { file: { version: NIC_JSON_VERSION, billLists: included.map(buildEwayBill) }, included, skipped };
}

/** Reads pasted portal output: one "document number  EWB number" pair per line, or a CSV/TSV with those columns. */
export function parseEwbPaste(text: string): { doc: string; ewb: string }[] {
  const out: { doc: string; ewb: string }[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    // Cells are tab/comma/semicolon separated; a plain "DOC EWB" line is split on spaces.
    let cells = line.split(/[,\t;|]+/).map(cell => cell.trim().replace(/^"|"$/g, "").trim()).filter(Boolean);
    if (cells.length === 1) cells = line.split(/\s+/).filter(Boolean);
    const ewbCell = cells.find(cell => /^[\d\s]+$/.test(cell) && cell.replace(/\s/g, "").length === 12);
    if (!ewbCell) continue;
    const ewb = ewbCell.replace(/\s/g, "");
    const doc = cells.find(cell => cell !== ewbCell && /[A-Za-z/-]/.test(cell) && !/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(cell) && cell.length <= 40);
    if (!doc || /^(doc|document|ewb|e-?way)/i.test(doc)) continue;
    const key = `${doc.toUpperCase()}|${ewb}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ doc: doc.toUpperCase(), ewb });
  }
  return out;
}
