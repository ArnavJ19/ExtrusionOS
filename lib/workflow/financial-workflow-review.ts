import { z } from "zod";

export const financialPaymentMethods = ["bank_transfer", "upi", "cheque", "cash", "credit_note", "other"] as const;
export const financialPaymentMethodSchema = z.enum(financialPaymentMethods);

export const receiptCsvMappingSchema = z.object({
  invoice_number: z.string().trim().min(1).max(160),
  payment_date: z.string().trim().min(1).max(160),
  amount: z.string().trim().min(1).max(160),
  payment_method: z.string().trim().min(1).max(160),
  reference_number: z.string().trim().max(160).nullable().optional(),
  notes: z.string().trim().max(160).nullable().optional(),
  date_format: z.enum(["iso", "dmy", "mdy"])
}).strict().superRefine((mapping, context) => {
  const selected = [mapping.invoice_number, mapping.payment_date, mapping.amount, mapping.payment_method,
    mapping.reference_number, mapping.notes].filter((value): value is string => Boolean(value));
  if (new Set(selected).size !== selected.length) {
    context.addIssue({ code: "custom", message: "Each receipt field must map to a different CSV column." });
  }
});

export type ReceiptCsvMapping = z.infer<typeof receiptCsvMappingSchema>;

export const receiptImportRowSchema = z.object({
  row_number: z.number().int().positive(),
  invoice_number: z.string().trim().max(80).optional().default(""),
  payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().default(""),
  amount: z.number().finite().positive().max(999_999_999_999.99).optional(),
  payment_method: financialPaymentMethodSchema.optional(),
  reference_number: z.string().trim().max(120).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  error: z.string().trim().max(500).optional()
}).strict();

export type ReceiptImportRow = z.infer<typeof receiptImportRowSchema>;

export type ReceiptCsvDocument = {
  headers: string[];
  rows: string[][];
};

export type ReceiptCsvPreview = {
  headers: string[];
  rows: ReceiptImportRow[];
};

export function parseReceiptCsvDocument(source: string): ReceiptCsvDocument {
  if (typeof source !== "string" || source.length > 512_000) {
    throw new Error("Receipt CSV must be smaller than 500 KB.");
  }
  const text = source.replace(/^\uFEFF/, "");
  const records: Array<{ line: number; fields: string[] }> = [];
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  let quoteClosed = false;
  let physicalLine = 1;
  let rowLine = 1;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
        quoteClosed = true;
      } else {
        field += char;
        if (char === "\n") physicalLine += 1;
      }
      continue;
    }

    if (quoteClosed && char !== "," && char !== "\r" && char !== "\n" && char !== " ") {
      throw new Error(`Unexpected character after a quoted field on CSV line ${physicalLine}.`);
    }
    if (char === '"' && field.length === 0 && !quoteClosed) {
      quoted = true;
    } else if (char === ",") {
      fields.push(field.trim());
      field = "";
      quoteClosed = false;
    } else if (char === "\r" || char === "\n") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      fields.push(field.trim());
      field = "";
      if (fields.some((value) => value !== "")) records.push({ line: rowLine, fields });
      fields = [];
      quoteClosed = false;
      physicalLine += 1;
      rowLine = physicalLine;
    } else if (!quoteClosed) {
      field += char;
    }
  }

  if (quoted) throw new Error(`CSV has an unclosed quoted field beginning on line ${rowLine}.`);
  fields.push(field.trim());
  if (fields.some((value) => value !== "")) records.push({ line: rowLine, fields });
  if (records.length < 2) throw new Error("CSV needs a header row and at least one receipt row.");

  const headers = records[0].fields.map((value) => value.trim());
  if (headers.length > 32 || headers.some((value) => !value) || new Set(headers.map((value) => value.toLocaleLowerCase())).size !== headers.length) {
    throw new Error("CSV headers must be non-empty and unique, with no more than 32 columns.");
  }
  if (records.length - 1 > 500) throw new Error("CSV can contain at most 500 receipt rows per import.");
  return {
    headers,
    rows: records.slice(1).map((record) => {
      if (record.fields.length > headers.length) throw new Error(`CSV line ${record.line} has more values than its header.`);
      return [...record.fields, ...Array(Math.max(0, headers.length - record.fields.length)).fill("")];
    })
  };
}

function parseReceiptDate(value: string, format: ReceiptCsvMapping["date_format"]): string | null {
  const input = value.trim();
  let match: RegExpMatchArray | null;
  if (format === "iso") {
    match = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    return validDate(match[1], match[2], match[3]);
  }
  match = input.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
  if (!match) return null;
  return format === "dmy"
    ? validDate(match[3], match[2], match[1])
    : validDate(match[3], match[1], match[2]);
}

function validDate(year: string, month: string, day: string): string | null {
  const normalized = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const date = new Date(`${normalized}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === normalized ? normalized : null;
}

function parseReceiptAmount(value: string): number | null {
  const input = value.trim();
  if (!/^\d[\d,]*(?:\.\d{1,2})?$/.test(input)) return null;
  const amount = Number(input.replaceAll(",", ""));
  return Number.isFinite(amount) && amount > 0 && amount <= 999_999_999_999.99 ? amount : null;
}

function parsePaymentMethod(value: string): (typeof financialPaymentMethods)[number] | null {
  const normalized = value.trim().toLocaleLowerCase().replace(/[\s-]+/g, "_");
  return financialPaymentMethodSchema.safeParse(normalized).success ? normalized as (typeof financialPaymentMethods)[number] : null;
}

export function previewReceiptCsv(source: string, mappingInput: ReceiptCsvMapping): ReceiptCsvPreview {
  const mapping = receiptCsvMappingSchema.parse(mappingInput);
  const document = parseReceiptCsvDocument(source);
  const positions: Record<string, number> = {};
  for (const [field, header] of Object.entries(mapping)) {
    if (typeof header === "string" && header) positions[field] = document.headers.indexOf(header);
  }
  for (const field of ["invoice_number", "payment_date", "amount", "payment_method"] as const) {
    if (positions[field] < 0) throw new Error(`Map ${field.replaceAll("_", " ")} to a CSV column before previewing.`);
  }
  for (const field of ["reference_number", "notes"] as const) {
    if (mapping[field] && positions[field] < 0) throw new Error(`The selected ${field.replaceAll("_", " ")} column is missing.`);
  }

  const seenReferences = new Set<string>();
  const rows = document.rows.map((columns, index) => {
    const value = (field: keyof ReceiptCsvMapping) => positions[field] >= 0 ? columns[positions[field]] ?? "" : "";
    const invoiceNumber = value("invoice_number").trim();
    const date = parseReceiptDate(value("payment_date"), mapping.date_format);
    const amount = parseReceiptAmount(value("amount"));
    const method = parsePaymentMethod(value("payment_method"));
    const reference = mapping.reference_number ? value("reference_number").trim() : "";
    const notes = mapping.notes ? value("notes").trim() : "";
    let error: string | undefined;

    if (!invoiceNumber || invoiceNumber.length > 80) error = "Invoice number is required and must be 80 characters or fewer.";
    else if (!date) error = "Receipt date is invalid for the selected date format.";
    else if (amount === null) error = "Amount must be positive INR with at most two decimal places.";
    else if (!method) error = "Payment method must be bank transfer, UPI, cheque, cash, credit note, or other.";
    else if (["bank_transfer", "upi", "cheque"].includes(method) && !reference) error = "Bank, UPI, and cheque rows require a reference number.";
    else if (reference.length > 120 || notes.length > 2000) error = "Reference or notes exceed the supported length.";

    const duplicateKey = method && date && reference
      ? `${method}|${date}|${reference.toLocaleLowerCase()}`
      : null;
    if (!error && duplicateKey && seenReferences.has(duplicateKey)) error = "Duplicate receipt reference in this CSV import.";
    if (!error && duplicateKey) seenReferences.add(duplicateKey);

    return {
      row_number: index + 2,
      invoice_number: invoiceNumber,
      payment_date: date ?? "",
      amount: amount ?? undefined,
      payment_method: method ?? undefined,
      reference_number: reference || null,
      notes: notes || null,
      error
    } satisfies ReceiptImportRow;
  });
  return { headers: document.headers, rows };
}

export function buildInvoiceFingerprintPayload(items: Array<Record<string, unknown>>, defaultGstPercent: number): string {
  const lines = items.map((item) => {
    const quantity = Number(item.quantity ?? 0);
    const unitRate = Number(item.unit_rate ?? 0);
    const lineTotal = Number(item.line_total ?? 0);
    const ownGst = item.gst_percent === null || item.gst_percent === undefined ? Number.NaN : Number(item.gst_percent);
    const gstPercent = Number.isFinite(ownGst) && ownGst >= 0 ? ownGst : defaultGstPercent;
    return {
      source_line_id: String(item.source_line_id ?? ""),
      quantity: Number.isFinite(quantity) ? quantity.toFixed(3) : "invalid",
      unit_rate: Number.isFinite(unitRate) ? unitRate.toFixed(2) : "invalid",
      line_total: Number.isFinite(lineTotal) ? lineTotal.toFixed(2) : "invalid",
      hsn_code: String(item.hsn_code ?? ""),
      gst_percent: gstPercent.toFixed(2)
    };
  }).sort((left, right) => left.source_line_id.localeCompare(right.source_line_id));
  return JSON.stringify({ default_gst_percent: defaultGstPercent.toFixed(2), lines });
}

export const receiptAllocationInputSchema = z.object({
  invoice_id: z.string().uuid(),
  amount: z.number().finite().positive().max(999_999_999_999.99)
}).strict();

export const receiptPostingResultSchema = z.object({
  receipt_id: z.string().uuid(),
  received_amount: z.number().finite().positive(),
  payment_method: financialPaymentMethodSchema,
  status: z.enum(["posted", "partially_reversed", "reversed"]),
  idempotent_replay: z.boolean(),
  allocations: z.array(z.object({
    invoice_id: z.string().uuid(),
    payment_id: z.string().uuid(),
    amount: z.number().finite().positive(),
    payment_status: z.string().min(1),
    balance_due: z.number().finite().nonnegative(),
    invoice_status: z.string().min(1)
  }).strict()).max(100)
}).strict();

export const receivableInvoiceSchema = z.object({
  id: z.string().uuid(),
  invoice_number: z.string().nullable(),
  invoice_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  grand_total: z.number().finite().nonnegative(),
  amount_paid: z.number().finite().nonnegative(),
  credited_amount: z.number().finite().nonnegative(),
  balance_due: z.number().finite().positive(),
  status: z.string().min(1),
  customer_name: z.string().nullable(),
  order_number: z.string().nullable(),
  overdue_days: z.number().int().nonnegative()
}).strict();

export const financialInvoiceReviewSchema = z.object({
  order_id: z.string().uuid(),
  order_number: z.string().nullable(),
  customer_id: z.string().uuid(),
  customer_name: z.string().nullable(),
  dispatch_id: z.string().uuid(),
  dispatch_number: z.string().nullable(),
  dispatch_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  delivery_status: z.string().min(1),
  source_fingerprint: z.string().regex(/^[0-9a-f]{32}$/),
  default_gst_percent: z.number().finite().nonnegative().max(100),
  subtotal: z.number().finite().positive(),
  tax_total: z.number().finite().nonnegative(),
  grand_total: z.number().finite().positive(),
  rows: z.array(z.object({
    source_line_id: z.string().uuid(),
    bundle_number: z.string().nullable(),
    profile_id: z.string().uuid().nullable(),
    description: z.string().nullable(),
    hsn_code: z.string().nullable(),
    quantity_kg: z.number().finite().positive(),
    rate_per_kg: z.number().finite().positive(),
    line_total: z.number().finite().positive(),
    gst_percent: z.number().finite().nonnegative().max(100),
    tax_amount: z.number().finite().nonnegative()
  }).strict()).min(1).max(5000)
}).strict();

export const correctionApplyInputSchema = z.object({
  record_type: z.enum(["invoice", "payment"]),
  record_id: z.string().uuid(),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  amount: z.number().finite().positive().max(999_999_999_999.99).optional(),
  reason: z.string().trim().min(5).max(1000),
  idempotency_key: z.string().uuid()
}).strict();

export const receiptImportResultSchema = z.object({
  batch_id: z.string().uuid(),
  source_fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  row_count: z.number().int().min(1).max(500),
  posted_count: z.number().int().min(0).max(500),
  failed_count: z.number().int().min(0).max(500),
  idempotent_replay: z.boolean(),
  rows: z.array(z.object({
    row_number: z.number().int().positive(),
    status: z.enum(["pending", "posted", "failed"]),
    error: z.string().nullable(),
    receipt_event_id: z.string().uuid().nullable(),
    payment_id: z.string().uuid().nullable()
  }).strict()).max(500)
}).strict();

export const correctionPreviewSchema = z.object({
  record_type: z.enum(["invoice", "payment"]),
  record_id: z.string().uuid(),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  state: z.string().min(1),
  summary: z.string().min(1),
  route: z.enum(["edit_draft", "reverse_receipt", "credit_adjustment", "unavailable"]),
  edit_url: z.string().nullable(),
  adjustment_limit: z.number().finite().nonnegative().nullable()
}).strict();
