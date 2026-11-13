// AP-082: e-invoice (IRP) JSON from issued invoices, and the IRN/QR import back onto them.
// Built from the issued invoice and its party snapshots, never from current masters. An invoice that cannot be mapped
// is skipped with the reason; nothing is filled with a zero or a guess. The file is uploaded by accounts to the IRP or
// their GSP tool; the IRN, acknowledgement and signed QR come back through importIrnResponse.

export const EINVOICE_SCHEMA_VERSION = "1.1";

export type EinvoiceItem = { description: string | null; hsn_code: string | null; quantity: number | string | null; unit_rate: number | string | null; line_total: number | string | null; gst_percent: number | string | null; line_kind: string | null };
export type EinvoiceSource = {
  invoice_id: string; invoice_number: string; invoice_date: string; status: string; supplier_state_code: string | null; place_of_supply_state_code: string | null;
  subtotal: number | string | null; tax_total: number | string | null; grand_total: number | string | null; cgst_amount: number | string | null; sgst_amount: number | string | null;
  utgst_amount: number | string | null; igst_amount: number | string | null; supplier: Record<string, unknown> | null; customer: Record<string, unknown> | null; has_irn: boolean; items: EinvoiceItem[];
};
export type EinvoiceIssue = { field: string; message: string };

const n = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const money = (v: number) => Math.round(v * 100) / 100;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ") : null);
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PIN = /^[1-9][0-9]{5}$/;

function party(snapshot: Record<string, unknown> | null) {
  const s = snapshot ?? {};
  const name = str(s.legal_name) ?? str(s.company_name) ?? str(s.name) ?? str(s.customer_name);
  const pin = str(s.pincode)?.replace(/\s/g, "") ?? null;
  return { gstin: str(s.gst_number)?.toUpperCase() ?? null, name, trade: str(s.name) ?? str(s.customer_name) ?? name, address: str(s.billing_address), city: str(s.city), pin,
    phone: str(s.phone)?.replace(/\D/g, "").slice(-10) ?? null, email: str(s.email) };
}

export function validateEinvoiceSource(source: EinvoiceSource): EinvoiceIssue[] {
  const issues: EinvoiceIssue[] = [];
  const seller = party(source.supplier), buyer = party(source.customer);
  if (source.has_irn) issues.push({ field: "irn", message: "An IRN is already recorded for this invoice." });
  if (!seller.gstin || !GSTIN.test(seller.gstin)) issues.push({ field: "seller_gstin", message: "Supplier GSTIN on the issued invoice is missing or invalid." });
  if (!buyer.gstin || !GSTIN.test(buyer.gstin)) issues.push({ field: "buyer_gstin", message: "Buyer is unregistered or its GSTIN is invalid; e-invoicing covers B2B invoices." });
  for (const [label, p] of [["Supplier", seller], ["Buyer", buyer]] as const) {
    if (!p.name || p.name.length < 3) issues.push({ field: `${label.toLowerCase()}_name`, message: `${label} legal name is missing.` });
    if (!p.address || p.address.length < 1) issues.push({ field: `${label.toLowerCase()}_address`, message: `${label} address is missing.` });
    if (!p.city || p.city.length < 3) issues.push({ field: `${label.toLowerCase()}_city`, message: `${label} city is missing.` });
    if (!p.pin || !PIN.test(p.pin)) issues.push({ field: `${label.toLowerCase()}_pin`, message: `${label} PIN code is missing or invalid.` });
  }
  if (!source.supplier_state_code || !/^\d{2}$/.test(source.supplier_state_code)) issues.push({ field: "supplier_state", message: "Supplier state code is missing." });
  if (!source.place_of_supply_state_code || !/^\d{2}$/.test(source.place_of_supply_state_code)) issues.push({ field: "place_of_supply", message: "Place of supply is missing." });
  if (!source.items.length) issues.push({ field: "items", message: "The invoice has no lines." });
  source.items.forEach((item, index) => {
    if (!item.hsn_code || !/^\d{4,8}$/.test(item.hsn_code)) issues.push({ field: `items.${index}.hsn`, message: `Line ${index + 1} HSN/SAC code is missing.` });
    if (n(item.line_total) === null || n(item.gst_percent) === null || n(item.quantity) === null) issues.push({ field: `items.${index}`, message: `Line ${index + 1} amount, quantity or GST rate is missing.` });
  });
  if (!issues.length) {
    const built = buildItems(source);
    const tax = (n(source.cgst_amount) ?? 0) + (n(source.sgst_amount) ?? 0) + (n(source.utgst_amount) ?? 0) + (n(source.igst_amount) ?? 0);
    if (Math.abs(built.assessable - (n(source.subtotal) ?? NaN)) > 0.05) issues.push({ field: "subtotal", message: "Line values do not add up to the invoice taxable value." });
    if (Math.abs(built.tax - tax) > 1) issues.push({ field: "tax", message: "Line-level GST does not reconcile with the invoice GST within ₹1." });
  }
  return issues;
}

function buildItems(source: EinvoiceSource) {
  const inter = source.supplier_state_code !== source.place_of_supply_state_code;
  let assessable = 0, tax = 0;
  const items = source.items.map((item, index) => {
    const amount = money(n(item.line_total) ?? 0), rate = n(item.gst_percent) ?? 0, qty = n(item.quantity) ?? 0;
    const service = item.line_kind === "freight_charge" || item.line_kind === "die_charge" || (item.hsn_code ?? "").startsWith("99");
    const igst = inter ? money(amount * rate / 100) : 0;
    const half = inter ? 0 : money(amount * rate / 200);
    assessable += amount; tax += igst + half * 2;
    return {
      SlNo: String(index + 1), PrdDesc: (str(item.description) ?? "Aluminium profile").slice(0, 300), IsServc: service ? "Y" : "N", HsnCd: item.hsn_code,
      Qty: Math.round(qty * 1000) / 1000, Unit: service ? "OTH" : "KGS", UnitPrice: Math.round((n(item.unit_rate) ?? 0) * 1000) / 1000,
      TotAmt: amount, Discount: 0, AssAmt: amount, GstRt: rate, IgstAmt: igst, CgstAmt: half, SgstAmt: half, CesRt: 0, CesAmt: 0, CesNonAdvlAmt: 0,
      StateCesRt: 0, StateCesAmt: 0, StateCesNonAdvlAmt: 0, OthChrg: 0, TotItemVal: money(amount + igst + half * 2)
    };
  });
  return { items, assessable: money(assessable), tax: money(tax), inter };
}

const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export function buildEinvoice(source: EinvoiceSource) {
  const seller = party(source.supplier), buyer = party(source.customer);
  const { items, inter } = buildItems(source);
  const cgst = n(source.cgst_amount) ?? 0, sgst = (n(source.sgst_amount) ?? 0) + (n(source.utgst_amount) ?? 0), igst = n(source.igst_amount) ?? 0;
  const assessable = money(n(source.subtotal) ?? 0), total = money(n(source.grand_total) ?? 0);
  const addr = (a: string | null) => ({ Addr1: (a ?? "").slice(0, 100), ...(a && a.length > 100 ? { Addr2: a.slice(100, 200) } : {}) });
  return {
    Version: EINVOICE_SCHEMA_VERSION,
    TranDtls: { TaxSch: "GST", SupTyp: "B2B", RegRev: "N", EcmGstin: null, IgstOnIntra: "N" },
    DocDtls: { Typ: "INV", No: source.invoice_number, Dt: dmy(source.invoice_date) },
    SellerDtls: { Gstin: seller.gstin, LglNm: seller.name, TrdNm: seller.trade, ...addr(seller.address), Loc: seller.city, Pin: Number(seller.pin), Stcd: source.supplier_state_code,
      ...(seller.phone && seller.phone.length >= 6 ? { Ph: seller.phone } : {}), ...(seller.email ? { Em: seller.email } : {}) },
    BuyerDtls: { Gstin: buyer.gstin, LglNm: buyer.name, TrdNm: buyer.trade, Pos: source.place_of_supply_state_code, ...addr(buyer.address), Loc: buyer.city, Pin: Number(buyer.pin),
      Stcd: buyer.gstin!.slice(0, 2) },
    ItemList: items,
    ValDtls: { AssVal: assessable, CgstVal: inter ? 0 : money(cgst), SgstVal: inter ? 0 : money(sgst), IgstVal: inter ? money(igst) : 0, CesVal: 0, StCesVal: 0, Discount: 0, OthChrg: 0,
      RndOffAmt: money(total - assessable - (inter ? igst : cgst + sgst)), TotInvVal: total }
  };
}

export type EinvoiceExport = { file: ReturnType<typeof buildEinvoice>[]; included: EinvoiceSource[]; skipped: { source: EinvoiceSource; issues: EinvoiceIssue[] }[] };
export function buildEinvoiceExport(sources: EinvoiceSource[]): EinvoiceExport {
  const included: EinvoiceSource[] = [], skipped: EinvoiceExport["skipped"] = [];
  for (const source of sources) { const issues = validateEinvoiceSource(source); if (issues.length) skipped.push({ source, issues }); else included.push(source); }
  return { file: included.map(buildEinvoice), included, skipped };
}

// ---- IRN response import ----
export type IrnRow = { doc_no: string; irn: string; ack_no: string; ack_date: string; signed_qr: string };
export type IrnParseResult = { rows: IrnRow[]; problems: { index: number; message: string }[] };

function base64UrlJson(part: string): Record<string, unknown> | null {
  try {
    const padded = part.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((part.length + 3) % 4);
    const bytes = Uint8Array.from(atob(padded), ch => ch.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch { return null; }
}

/** Reads the document details the IRP signs into the QR (JWT payload "data"). */
export function decodeSignedQr(token: string): { DocNo?: string; Irn?: string; DocDt?: string; SellerGstin?: string } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const payload = base64UrlJson(parts[1]);
  if (!payload) return null;
  const data = typeof payload.data === "string" ? (() => { try { return JSON.parse(payload.data as string); } catch { return null; } })() : payload;
  return data && typeof data === "object" ? data as Record<string, string> : null;
}

function ackIso(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(value.trim());
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? "00"}+05:30`;
  const d = /^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(value.trim());
  if (d) return `${d[3]}-${d[2]}-${d[1]}T${d[4]}:${d[5]}:${d[6] ?? "00"}+05:30`;
  return null;
}

/** Accepts the IRP/GSP response: one object, an array, or { data: [...] }, with Irn, AckNo, AckDt and SignedQRCode. */
export function parseIrnResponse(text: string): IrnParseResult {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return { rows: [], problems: [{ index: 0, message: "The file is not valid JSON." }] }; }
  const list = Array.isArray(parsed) ? parsed : Array.isArray((parsed as { data?: unknown })?.data) ? (parsed as { data: unknown[] }).data : [parsed];
  const rows: IrnRow[] = [], problems: IrnParseResult["problems"] = [];
  list.forEach((raw, index) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const pick = (...keys: string[]) => { for (const k of keys) { const v = r[k] ?? (r.Data as Record<string, unknown> | undefined)?.[k]; if (v !== undefined && v !== null && String(v).trim()) return String(v).trim(); } return null; };
    const qr = pick("SignedQRCode", "signedQRCode", "SignedQrCode");
    const irn = pick("Irn", "IRN", "irn")?.toLowerCase() ?? null;
    const ack = pick("AckNo", "ackNo", "AckNumber"), ackDt = pick("AckDt", "ackDt", "AckDate");
    const decoded = qr ? decodeSignedQr(qr) : null;
    const doc = pick("DocNo", "docNo", "InvoiceNo") ?? ((r.DocDtls as Record<string, unknown> | undefined)?.No as string | undefined) ?? decoded?.DocNo ?? null;
    if (!qr || !irn || !ack || !ackDt || !doc) { problems.push({ index: index + 1, message: "Irn, AckNo, AckDt, SignedQRCode and the document number are all required." }); return; }
    if (!/^[0-9a-f]{64}$/.test(irn)) { problems.push({ index: index + 1, message: `Document ${doc}: the IRN is not a 64-character hash.` }); return; }
    if (decoded?.Irn && decoded.Irn.toLowerCase() !== irn) { problems.push({ index: index + 1, message: `Document ${doc}: the signed QR belongs to a different IRN.` }); return; }
    if (decoded?.DocNo && decoded.DocNo !== doc) { problems.push({ index: index + 1, message: `Document ${doc}: the signed QR names document ${decoded.DocNo}.` }); return; }
    const ackDate = ackIso(ackDt);
    if (!ackDate) { problems.push({ index: index + 1, message: `Document ${doc}: the acknowledgement date is not readable.` }); return; }
    rows.push({ doc_no: doc, irn, ack_no: ack.replace(/\D/g, ""), ack_date: ackDate, signed_qr: qr });
  });
  return { rows, problems };
}
