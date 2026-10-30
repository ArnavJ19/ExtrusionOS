import { z } from "zod";

const uuid = z.string().uuid();
const moneyBase = z.coerce.number().finite().min(0).max(1_000_000_000_000);
const atPrecision = (places: number) => (value: number) => Math.abs(value * 10 ** places - Math.round(value * 10 ** places)) < 1e-7;
const amount = moneyBase.refine(atPrecision(2), "INR amounts may have at most two decimal places.");
const quantityBase = z.coerce.number().finite().min(0).max(100_000_000);
const quantityPrecision = quantityBase.refine(atPrecision(3), "Quantities may have at most three decimal places.");
const quantity = quantityBase.positive().refine(atPrecision(3), "Quantities may have at most three decimal places.");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").refine(value => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Enter a valid calendar date.");
const optionalDate = date.nullable().optional();
const units = ["kg", "m", "piece", "set", "box", "lot"] as const;

export function purchaseReceiptBalances(line: { ordered_quantity: number; received_quantity: number; accepted_quantity: number; unit_rate: number }) {
  const { ordered_quantity: ordered, received_quantity: received, accepted_quantity: accepted, unit_rate: rate } = line;
  if (![ordered, received, accepted, rate].every(value => Number.isFinite(value) && value >= 0) || accepted > received || received > ordered) {
    throw new Error("Receipt quantities must be consistent with the purchase order.");
  }
  return {
    remaining_delivery: Math.round((ordered - received) * 1000) / 1000,
    remaining_acceptance: Math.round((ordered - accepted) * 1000) / 1000,
    received_base_value: Math.round(received * rate * 100) / 100,
    accepted_base_value: Math.round(accepted * rate * 100) / 100
  };
}

function kolkataToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

const receiptDate = date.refine((value) => value <= kolkataToday(), "Receipt date cannot be in the future (Asia/Kolkata).");

export const purchaseOrderLineInputSchema = z.object({
  description: z.string().trim().min(3).max(240),
  specification: z.string().trim().min(3).max(1000),
  unit: z.enum(units),
  quantity,
  rate: amount,
  gst_percent: z.coerce.number().finite().min(0).max(100),
  rate_tolerance: moneyBase.max(1000).refine(atPrecision(2)).default(0.01),
  tax_tolerance: moneyBase.max(1000).refine(atPrecision(2)).default(0.01)
}).strict();

const receiptLineInputSchema = z.object({
  purchase_order_line_id: uuid,
  received_quantity: quantity,
  accepted_quantity: quantityPrecision,
  rejected_quantity: quantityPrecision,
  held_quantity: quantityPrecision,
  note: z.string().trim().max(1000).optional().nullable()
}).strict().superRefine((line, ctx) => {
  if (Math.round((line.accepted_quantity + line.rejected_quantity + line.held_quantity) * 1000)
    !== Math.round(line.received_quantity * 1000)) {
    ctx.addIssue({ code: "custom", path: ["received_quantity"], message: "Received quantity must equal accepted + rejected + held." });
  }
});

const reviewedBillLineSchema = z.object({
  purchase_order_line_id: uuid,
  quantity,
  unit: z.enum(units),
  rate: amount,
  base_amount: moneyBase.positive().refine(atPrecision(2)),
  tax_amount: amount
}).strict();

export const supplierBillReviewSchema = z.object({
  vendor_id: uuid,
  purchase_order_id: uuid,
  invoice_number: z.string().trim().min(1).max(120),
  invoice_date: date,
  due_date: optionalDate,
  tax_amount: amount,
  freight_amount: amount,
  discount_amount: amount,
  total_amount: moneyBase.positive().refine(atPrecision(2)),
  lines: z.array(reviewedBillLineSchema).min(1).max(100)
}).strict().superRefine((bill, ctx) => {
  const base = bill.lines.reduce((sum, line) => sum + Math.round(line.base_amount * 100), 0);
  const lineTax = bill.lines.reduce((sum, line) => sum + Math.round(line.tax_amount * 100), 0);
  const computed = base + lineTax + Math.round(bill.freight_amount * 100) - Math.round(bill.discount_amount * 100);
  if (lineTax !== Math.round(bill.tax_amount * 100)) {
    ctx.addIssue({ code: "custom", path: ["tax_amount"], message: "Bill tax must equal the reviewed line tax amounts." });
  }
  if (computed !== Math.round(bill.total_amount * 100)) {
    ctx.addIssue({ code: "custom", path: ["total_amount"], message: "Total must equal base + tax + freight - discount." });
  }
  if (bill.due_date && bill.due_date < bill.invoice_date) {
    ctx.addIssue({ code: "custom", path: ["due_date"], message: "Due date cannot be before invoice date." });
  }
  const lineIds = bill.lines.map((line) => line.purchase_order_line_id);
  if (new Set(lineIds).size !== lineIds.length) {
    ctx.addIssue({ code: "custom", path: ["lines"], message: "Each purchase order line can appear only once on a supplier bill." });
  }
  bill.lines.forEach((line, index) => {
    if (Math.round(line.quantity * line.rate * 100) !== Math.round(line.base_amount * 100)) {
      ctx.addIssue({ code: "custom", path: ["lines", index, "base_amount"], message: "Line base must equal quantity x rate." });
  }
  });
});

const commandSchemas = [
  z.object({ command: z.literal("dashboard.load"), payload: z.object({}).strict() }).strict(),
  z.object({ command: z.literal("orders.list"), payload: z.object({ page: z.coerce.number().int().min(1).max(10000).default(1), search: z.string().trim().max(80).default(""), status: z.enum(["all", "draft", "open"]).default("all"), sort: z.enum(["date", "supplier", "number", "status"]).default("date"), direction: z.enum(["asc", "desc"]).default("desc") }).strict() }).strict(),
  z.object({ command: z.literal("bills.list"), payload: z.object({ page: z.coerce.number().int().min(1).max(10000).default(1), search: z.string().trim().max(80).default(""), status: z.enum(["all", "draft", "posted"]).default("all"), sort: z.enum(["date", "supplier", "invoice", "amount", "status"]).default("date"), direction: z.enum(["asc", "desc"]).default("desc") }).strict() }).strict(),
  z.object({ command: z.literal("order.load"), payload: z.object({ purchase_order_id: uuid }).strict() }).strict(),
  z.object({ command: z.literal("bill.load"), payload: z.object({ bill_id: uuid }).strict() }).strict(),
  z.object({ command: z.literal("order.create"), payload: z.object({
    idempotency_key: uuid, vendor_id: uuid, order_date: date,
    expected_freight_amount: amount.default(0), expected_discount_amount: amount.default(0),
    freight_tolerance: moneyBase.max(1000).refine(atPrecision(2)).default(0.01), discount_tolerance: moneyBase.max(1000).refine(atPrecision(2)).default(0.01),
    total_tolerance: moneyBase.max(1000).refine(atPrecision(2)).default(0.01), lines: z.array(purchaseOrderLineInputSchema).min(1).max(100)
  }).strict() }).strict(),
  z.object({ command: z.literal("order.issue"), payload: z.object({ purchase_order_id: uuid }).strict() }).strict(),
  z.object({ command: z.literal("receipt.record"), payload: z.object({
    idempotency_key: uuid, purchase_order_id: uuid, receipt_date: receiptDate,
    reference: z.string().trim().max(120).nullable().optional(), lines: z.array(receiptLineInputSchema).min(1).max(100)
  }).strict().superRefine((receipt, ctx) => {
    const ids = receipt.lines.map((line) => line.purchase_order_line_id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", path: ["lines"], message: "Each purchase order line can appear only once per receipt." });
  }) }).strict(),
  z.object({ command: z.literal("document.create"), payload: z.object({
    source_hash: z.string().regex(/^[0-9a-f]{64}$/), source_name: z.string().trim().min(1).max(180),
    proposal: z.record(z.unknown()), uncertain_fields: z.array(z.string().max(120)).max(100)
  }).strict() }).strict(),
  z.object({ command: z.literal("document.load"), payload: z.object({ source_id: uuid, source_hash: z.string().regex(/^[0-9a-f]{64}$/) }).strict() }).strict(),
  z.object({ command: z.literal("document.review"), payload: z.object({
    source_id: uuid, source_hash: z.string().regex(/^[0-9a-f]{64}$/), expected_revision: z.number().int().min(0),
    reviewed: supplierBillReviewSchema
  }).strict() }).strict(),
  z.object({ command: z.literal("bill.create"), payload: z.object({
    source_id: uuid, source_hash: z.string().regex(/^[0-9a-f]{64}$/), review_revision: z.number().int().positive(), review_hash: z.string().regex(/^[0-9a-f]{32}$/)
  }).strict() }).strict(),
  z.object({ command: z.literal("bill.match"), payload: z.object({ bill_id: uuid }).strict() }).strict(),
  z.object({ command: z.literal("bill.post"), payload: z.object({
    bill_id: uuid, source_hash: z.string().regex(/^[0-9a-f]{64}$/), review_revision: z.number().int().positive(), review_hash: z.string().regex(/^[0-9a-f]{32}$/)
  }).strict() }).strict()
] as const;

export const purchaseLifecycleInputSchema = z.discriminatedUnion("command", commandSchemas);
export type PurchaseLifecycleInput = z.input<typeof purchaseLifecycleInputSchema>;
export type PurchaseLifecycleCommand = z.infer<typeof purchaseLifecycleInputSchema>;

const proposalLineSchema = z.object({
  description: z.string().nullable(), quantity: z.number().finite().nullable(), unit: z.string().nullable(),
  rate: z.number().finite().nullable(), base_amount: z.number().finite().nullable(), tax_amount: z.number().finite().nullable()
}).strict();
export const supplierDocumentProposalSchema = z.object({
  vendor_name: z.string().nullable(), invoice_number: z.string().nullable(), invoice_date: z.string().nullable(),
  quantity: z.number().finite().nullable(), unit: z.string().nullable(), rate: z.number().finite().nullable(),
  description: z.string().nullable(), base_amount: z.number().finite().nullable(), tax_amount: z.number().finite().nullable(),
  freight_amount: z.number().finite().nullable(), discount_amount: z.number().finite().nullable(), total_amount: z.number().finite().nullable(),
  lines: z.array(proposalLineSchema).max(100)
}).strict();
export type SupplierDocumentProposal = z.infer<typeof supplierDocumentProposalSchema>;

const matchLineSchema = z.object({
  description: z.string(), unit: z.string(), quantity: z.number(), accepted_received: z.number(), previously_billed: z.number(),
  rate: z.number(), po_rate: z.number(), base_amount: z.number(), tax_amount: z.number()
}).strict();
export const purchaseMatchSnapshotSchema = z.object({
  matched: z.boolean(), exceptions: z.array(z.string()), lines: z.array(matchLineSchema),
  expected: z.object({ base_amount: z.number(), tax_amount: z.number(), freight_amount: z.number(), discount_amount: z.number(), total_amount: z.number() }).strict(),
  actual: z.object({ base_amount: z.number(), tax_amount: z.number(), freight_amount: z.number(), discount_amount: z.number(), total_amount: z.number() }).strict()
}).strict();
const orderLineViewSchema = z.object({
  id: uuid, line_number: z.number().int(), description: z.string(), specification: z.string(), unit: z.enum(units),
  ordered_quantity: z.number(), unit_rate: z.number(), gst_percent: z.number(), received_quantity: z.number(),
  accepted_quantity: z.number(), rejected_quantity: z.number(), held_quantity: z.number(), billed_quantity: z.number()
}).strict();
const orderSummarySchema = z.object({
  id: uuid, po_number: z.string(), vendor_id: uuid, vendor_name: z.string(), order_date: z.string(), status: z.enum(["draft", "open"]),
  expected_freight_amount: z.number(), expected_discount_amount: z.number(), created_at: z.string().optional(), lines: z.array(orderLineViewSchema).optional()
}).strict();
const billSummarySchema = z.object({
  id: uuid, invoice_number: z.string(), invoice_date: z.string(), vendor_name: z.string(), po_number: z.string(), total_amount: z.number(),
  status: z.enum(["draft", "posted"]), match_status: z.enum(["unmatched", "matched"]), match_snapshot: purchaseMatchSnapshotSchema,
  expense_ledger_id: uuid.nullable(), vendor_id: uuid.optional(), source_name: z.string().optional(), created_at: z.string().optional()
}).strict();
const loadedOrderSchema = orderSummarySchema.extend({ lines: z.array(orderLineViewSchema) }).strict();
const documentResultSchema = z.object({
  kind: z.literal("document"), id: uuid, source_hash: z.string().regex(/^[0-9a-f]{64}$/), source_name: z.string(),
  proposal: supplierDocumentProposalSchema, uncertain_fields: z.array(z.string()), review_revision: z.number().int(),
  review_hash: z.string().regex(/^[0-9a-f]{32}$/).nullable(), reviewed_payload: z.record(z.unknown()).nullable(), idempotent_replay: z.boolean()
}).strict();
const loadedBillSchema = z.object({
  id: uuid, vendor_id: uuid, purchase_order_id: uuid, invoice_number: z.string(), invoice_date: z.string(), due_date: z.string().nullable(),
  tax_amount: z.number(), freight_amount: z.number(), discount_amount: z.number(), total_amount: z.number(),
  status: z.enum(["draft", "posted"]), match_status: z.enum(["unmatched", "matched"]), match_snapshot: purchaseMatchSnapshotSchema,
  source_hash: z.string().regex(/^[0-9a-f]{64}$/), review_revision: z.number().int().positive(), review_hash: z.string().regex(/^[0-9a-f]{32}$/),
  expense_ledger_id: uuid.nullable(), lines: z.array(z.object({
    purchase_order_line_id: uuid, quantity: z.number(), unit: z.enum(units), rate: z.number(), base_amount: z.number(), tax_amount: z.number()
  }).strict()),
  source: documentResultSchema,
  order: loadedOrderSchema
}).strict();
export const purchaseLifecycleResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("dashboard"), vendors: z.array(z.object({ id: uuid, vendor_name: z.string() }).strict()), orders: z.array(orderSummarySchema), bills: z.array(billSummarySchema) }).strict(),
  z.object({ kind: z.literal("orders"), items: z.array(orderSummarySchema), page: z.number().int(), total: z.number().int() }).strict(),
  z.object({ kind: z.literal("bills"), items: z.array(billSummarySchema), page: z.number().int(), total: z.number().int() }).strict(),
  z.object({ kind: z.literal("order_loaded"), order: loadedOrderSchema }).strict(),
  z.object({ kind: z.literal("bill_loaded"), bill: loadedBillSchema }).strict(),
  z.object({ kind: z.literal("order_created"), id: uuid, po_number: z.string(), status: z.enum(["draft", "open"]), idempotent_replay: z.boolean() }).strict(),
  z.object({ kind: z.literal("order_issued"), id: uuid, po_number: z.string(), status: z.literal("open"), idempotent_replay: z.boolean() }).strict(),
  z.object({ kind: z.literal("receipt_recorded"), id: uuid, idempotent_replay: z.boolean() }).strict(),
  documentResultSchema,
  z.object({ kind: z.literal("document_reviewed"), source_id: uuid, review_revision: z.number().int(), review_hash: z.string().regex(/^[0-9a-f]{32}$/), bill_id: uuid.nullable(), idempotent_replay: z.boolean() }).strict(),
  z.object({ kind: z.literal("bill_created"), id: uuid, status: z.enum(["draft", "posted"]), match_status: z.enum(["unmatched", "matched"]), match_snapshot: purchaseMatchSnapshotSchema, idempotent_replay: z.boolean() }).strict(),
  z.object({ kind: z.literal("bill_match"), id: uuid, status: z.enum(["draft", "posted"]), match_status: z.enum(["unmatched", "matched"]), match_snapshot: purchaseMatchSnapshotSchema, idempotent_replay: z.boolean() }).strict(),
  z.object({ kind: z.literal("bill_posted"), id: uuid, expense_ledger_id: uuid, approval_status: z.literal("pending_approval"), idempotent_replay: z.boolean() }).strict()
]);
export type PurchaseLifecycleResult = z.infer<typeof purchaseLifecycleResultSchema>;

export type SupplierTextParseResult = { proposal: SupplierDocumentProposal; uncertainFields: string[] };

function normalizeField(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseCsvRow(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') { cell += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) { cells.push(cell.trim()); cell = ""; }
    else cell += character;
  }
  cells.push(cell.trim());
  return cells;
}

function parseAmount(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const cleaned = value.replace(/[₹$\s,]/g, "").replace(/^(INR|RS\.?)/i, "");
  if (!/^-?\d+(?:\.\d{1,4})?$/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDate(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  const text = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
  const parts = iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : dmy ? [Number(dmy[3]), Number(dmy[2]), Number(dmy[1])] : null;
  if (!parts) return null;
  const [year, month, day] = parts;
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const fieldAliases: Record<string, string> = {
  vendor: "vendor_name", supplier: "vendor_name", suppliername: "vendor_name", vendorname: "vendor_name",
  invoicenumber: "invoice_number", invoiceno: "invoice_number", billnumber: "invoice_number", billno: "invoice_number", documentnumber: "invoice_number",
  invoicedate: "invoice_date", billdate: "invoice_date", date: "invoice_date",
  quantity: "quantity", qty: "quantity", unit: "unit", uom: "unit", rate: "rate", unitrate: "rate",
  description: "description", item: "description", product: "description", base: "base_amount", baseamount: "base_amount", subtotal: "base_amount", taxablevalue: "base_amount",
  tax: "tax_amount", taxamount: "tax_amount", gst: "tax_amount", gstamount: "tax_amount",
  freight: "freight_amount", freightamount: "freight_amount", discount: "discount_amount", discountamount: "discount_amount",
  total: "total_amount", totalamount: "total_amount", grandtotal: "total_amount", invoicetotal: "total_amount"
};

export function normalizeSupplierInvoiceNumber(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function parseSupplierInvoiceText(text: string): SupplierTextParseResult {
  const values = new Map<string, string>();
  const uncertain = new Set<string>();
  const lines: Array<{ description: string | null; quantity: number | null; unit: string | null; rate: number | null; base_amount: number | null; tax_amount: number | null }> = [];
  const setValue = (field: string, value: string) => {
    const cleaned = value.trim();
    if (!cleaned) return;
    const previous = values.get(field);
    if (previous && previous.toLowerCase() !== cleaned.toLowerCase()) { uncertain.add(field); return; }
    values.set(field, cleaned);
  };
  const acceptObject = (headers: string[], row: string[]) => {
    const mapped = new Map<string, string>();
    headers.forEach((header, index) => {
      const field = fieldAliases[normalizeField(header)];
      if (field && row[index]) mapped.set(field, row[index]);
    });
    for (const field of ["vendor_name", "invoice_number", "invoice_date", "tax_amount", "freight_amount", "discount_amount", "total_amount"]) {
      const value = mapped.get(field);
      if (value) setValue(field, value);
    }
    const description = mapped.get("description")?.trim() || null;
    const quantityValue = parseAmount(mapped.get("quantity"));
    const rateValue = parseAmount(mapped.get("rate"));
    const baseValue = parseAmount(mapped.get("base_amount"));
    const taxValue = parseAmount(mapped.get("tax_amount"));
    if (description || quantityValue != null || rateValue != null || baseValue != null) {
      lines.push({ description, quantity: quantityValue, unit: mapped.get("unit")?.trim() || null, rate: rateValue, base_amount: baseValue, tax_amount: taxValue });
    }
  };

  const rows = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (rows.length > 1) {
    const header = parseCsvRow(rows[0]);
    const normalizedHeader = header.map(normalizeField);
    const hasColumns = normalizedHeader.some((value) => ["description", "item", "product"].includes(value))
      && normalizedHeader.some((value) => ["quantity", "qty"].includes(value));
    if (hasColumns) {
      for (const row of rows.slice(1)) acceptObject(header, parseCsvRow(row));
    } else if (normalizedHeader.length === 2 && ["field", "name", "key"].includes(normalizedHeader[0]) && ["value", "text"].includes(normalizedHeader[1])) {
      for (const row of rows.slice(1)) {
        const [key, value] = parseCsvRow(row);
        const field = fieldAliases[normalizeField(key ?? "")];
        if (field) setValue(field, value ?? "");
        if (normalizeField(key ?? "") === "line") {
          const [description, qty, unit, rate, base, tax] = (value ?? "").split("|").map((part) => part.trim());
          lines.push({ description: description || null, quantity: parseAmount(qty), unit: unit || null, rate: parseAmount(rate), base_amount: parseAmount(base), tax_amount: parseAmount(tax) });
        }
      }
    }
  }
  for (const row of rows) {
    const match = /^([^:]+):\s*(.*)$/.exec(row);
    if (!match) continue;
    const key = normalizeField(match[1]);
    const field = fieldAliases[key];
    if (field) setValue(field, match[2]);
    if (key === "line" || key === "itemline") {
      const [description, qty, unit, rate, base, tax] = match[2].split("|").map((part) => part.trim());
      lines.push({ description: description || null, quantity: parseAmount(qty), unit: unit || null, rate: parseAmount(rate), base_amount: parseAmount(base), tax_amount: parseAmount(tax) });
    }
  }
  if (!lines.length && (values.has("description") || values.has("quantity") || values.has("rate") || values.has("base_amount"))) {
    lines.push({ description: values.get("description") ?? null, quantity: parseAmount(values.get("quantity")), unit: values.get("unit") ?? null,
      rate: parseAmount(values.get("rate")), base_amount: parseAmount(values.get("base_amount")), tax_amount: parseAmount(values.get("tax_amount")) });
  }
  if (lines.length > 100) { lines.length = 100; uncertain.add("lines"); }

  const proposal: SupplierDocumentProposal = {
    vendor_name: values.get("vendor_name")?.trim() || null,
    invoice_number: values.get("invoice_number")?.trim() || null,
    invoice_date: parseDate(values.get("invoice_date")),
    quantity: parseAmount(values.get("quantity")), unit: values.get("unit")?.trim() || null,
    rate: parseAmount(values.get("rate")), description: values.get("description")?.trim() || null,
    base_amount: parseAmount(values.get("base_amount")), tax_amount: parseAmount(values.get("tax_amount")),
    freight_amount: parseAmount(values.get("freight_amount")), discount_amount: parseAmount(values.get("discount_amount")),
    total_amount: parseAmount(values.get("total_amount")), lines
  };
  if (values.has("invoice_date") && proposal.invoice_date === null) uncertain.add("invoice_date");
  for (const [field, value] of [
    ["vendor_name", proposal.vendor_name], ["invoice_number", proposal.invoice_number],
    ["invoice_date", proposal.invoice_date], ["total_amount", proposal.total_amount]
  ] as const) {
    if (value == null) uncertain.add(field);
  }
  if (!lines.length) uncertain.add("lines");
  lines.forEach((line, index) => {
    for (const field of ["description", "quantity", "unit", "rate", "base_amount", "tax_amount"] as const) {
      if (line[field] == null) uncertain.add(`lines.${index + 1}.${field}`);
    }
  });
  uncertain.add("vendor_id");
  uncertain.add("purchase_order_id");
  for (const [field, value] of [
    ["tax_amount", proposal.tax_amount], ["freight_amount", proposal.freight_amount], ["discount_amount", proposal.discount_amount]
  ] as const) {
    if (value == null) uncertain.add(field);
  }
  return { proposal, uncertainFields: [...uncertain].sort() };
}
