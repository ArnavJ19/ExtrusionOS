import { signedCollectionAmount, signedSettlementAmount, type ReceivablePayment } from "../financials/receivables.ts";

// Report Builder sources, financial semantics and statement totals (RPT-03, RPT-04, PDF-04).
// Exports follow the same rules as the authoritative finance queries:
//   * payments: only posted (PAID) receipts by default; refunds are signed negative and credit
//     adjustments are excluded from cash collections;
//   * expenses: soft-deleted rows are never exported and totals are kept per currency;
//   * credit notes and supplier payments: reversed documents are excluded unless requested.

export const reportFieldMap: Record<string, string[]> = {
  customers: ["customer_name", "company_name", "customer_type", "city", "state", "created_at"],
  quotes: ["quote_number", "quote_date", "status", "grand_total", "customer_id", "created_at"],
  orders: ["order_number", "order_date", "current_stage", "order_value", "customer_id", "created_at"],
  dispatches: ["dispatch_date", "delivery_status", "vehicle_number", "total_weight_kg", "created_at"],
  invoices: ["invoice_number", "invoice_date", "due_date", "status", "customer_id", "grand_total", "amount_paid", "credited_amount", "balance_due", "customer_credit_due", "created_at"],
  payments: ["payment_date", "payment_method", "payment_type", "payment_status", "amount", "signed_amount", "collection_amount", "reference_number", "invoice_id", "created_at"],
  credit_notes: ["credit_note_number", "credit_date", "status", "invoice_id", "reason", "subtotal", "tax_total", "grand_total", "created_at"],
  expenses: ["expense_number", "expense_category", "expense_subcategory", "vendor_name_snapshot", "invoice_date", "currency", "total_amount", "amount_paid", "refunded_amount", "credited_amount", "balance_amount", "supplier_credit_due", "payment_status", "approval_status", "invoice_number", "created_at"],
  expense_payments: ["payment_date", "amount_paid", "payment_method", "reference_number", "status", "expense_ledger_id", "created_at"],
  inventory: ["item_code", "item_name", "item_category", "current_stock", "reorder_level", "created_at"],
  production_jobs: ["job_number", "planned_quantity_kg", "actual_quantity_kg", "status", "planned_date", "created_at"],
  scrap_records: ["scrap_type", "weight_kg", "reason", "recorded_date", "production_job_id", "created_at"],
  dies: ["die_number", "die_status", "total_production_kg", "total_runs", "last_used_date", "created_at"],
  quality_tests: ["inspection_date", "status", "batch_number", "quantity_checked_kg", "inspector_name", "created_at"],
  vendors: ["vendor_name", "vendor_type", "city", "state", "is_active", "created_at"],
  packaging_material_purchases: ["purchase_number", "received_date", "material_id", "vendor_id", "quantity", "rate", "total_amount", "payment_status", "invoice_number", "created_at"]
};

export const reportSourceTableMap: Record<string, string> = {
  customers: "customers", quotes: "quotes", orders: "orders", dispatches: "dispatches", invoices: "invoices", payments: "payments",
  credit_notes: "credit_notes", expenses: "expense_ledger", expense_payments: "expense_payments", inventory: "inventory_items",
  production_jobs: "production_jobs", scrap_records: "scrap_records", dies: "dies", quality_tests: "quality_inspections",
  vendors: "vendors", packaging_material_purchases: "packaging_material_purchases"
};

export const reportSourceDateFieldMap: Record<string, string> = {
  customers: "created_at", quotes: "quote_date", orders: "order_date", dispatches: "dispatch_date", invoices: "invoice_date",
  payments: "payment_date", credit_notes: "credit_date", expenses: "invoice_date", expense_payments: "payment_date",
  inventory: "created_at", production_jobs: "planned_date", scrap_records: "recorded_date", dies: "last_used_date",
  quality_tests: "inspection_date", vendors: "created_at", packaging_material_purchases: "received_date"
};

/** Fields computed after the query; they are never sent to PostgREST. */
export const reportVirtualFields: Record<string, string[]> = { payments: ["signed_amount", "collection_amount"] };

/** Columns always fetched because the source's semantics depend on them. */
const requiredFields: Record<string, string[]> = {
  payments: ["payment_status", "payment_type", "payment_method", "amount"],
  expenses: ["currency"],
  credit_notes: ["status"],
  expense_payments: ["status"]
};

/** Amount columns that are totalled per group and for the whole statement. */
export const reportAmountFields: Record<string, string[]> = {
  quotes: ["grand_total"], orders: ["order_value"], invoices: ["grand_total", "amount_paid", "credited_amount", "balance_due", "customer_credit_due"],
  payments: ["signed_amount", "collection_amount"], credit_notes: ["subtotal", "tax_total", "grand_total"],
  expenses: ["total_amount", "amount_paid", "refunded_amount", "credited_amount", "balance_amount", "supplier_credit_due"],
  expense_payments: ["amount_paid"], dispatches: ["total_weight_kg"], production_jobs: ["planned_quantity_kg", "actual_quantity_kg"],
  scrap_records: ["weight_kg"], packaging_material_purchases: ["total_amount"]
};

export type ReportFilter = { field?: string; operator?: string; value?: string };
export type ImplicitFilter = { field: string; operator: "eq" | "is_null"; value?: string; label: string };

export function reportSelectFields(source: string, selected: string[]) {
  const virtual = new Set(reportVirtualFields[source] ?? []);
  return Array.from(new Set([...selected.filter((field) => !virtual.has(field)), ...(requiredFields[source] ?? [])]));
}

export function reportImplicitFilters(source: string, filters: ReportFilter[]): ImplicitFilter[] {
  const filtered = (field: string) => filters.some((filter) => filter?.field === field && filter.value);
  if (source === "payments" && !filtered("payment_status")) return [{ field: "payment_status", operator: "eq", value: "PAID", label: "Posted receipts only (reversed receipts excluded)" }];
  if (source === "credit_notes" && !filtered("status")) return [{ field: "status", operator: "eq", value: "issued", label: "Issued credit notes only (reversed excluded)" }];
  if (source === "expense_payments" && !filtered("status")) return [{ field: "status", operator: "eq", value: "posted", label: "Posted supplier payments only (reversed excluded)" }];
  if (source === "expenses") return [{ field: "deleted_at", operator: "is_null", label: "Deleted expenses excluded" }];
  return [];
}

export function deriveReportRow(source: string, row: Record<string, unknown>) {
  if (source !== "payments") return row;
  const payment = row as unknown as ReceivablePayment;
  return { ...row, signed_amount: signedSettlementAmount(payment), collection_amount: signedCollectionAmount(payment) };
}

export type ReportTotals = {
  label: string;
  count: number;
  /** Totals keyed by currency, then by amount field. Non-INR expenses are never added to INR. */
  byCurrency: Record<string, Record<string, number>>;
  /** Rows behind each currency's totals. */
  countByCurrency: Record<string, number>;
};

export function computeReportTotals(source: string, rows: Record<string, unknown>[], grouping: string | null, groupLabel: (value: unknown) => string = (value) => String(value ?? "-")) {
  const fields = reportAmountFields[source] ?? [];
  const blank = (label: string): ReportTotals => ({ label, count: 0, byCurrency: {}, countByCurrency: {} });
  const add = (target: ReportTotals, row: Record<string, unknown>) => {
    target.count += 1;
    const currency = source === "expenses" ? String(row.currency || "INR") : "INR";
    target.countByCurrency[currency] = (target.countByCurrency[currency] ?? 0) + 1;
    const bucket = (target.byCurrency[currency] ??= Object.fromEntries(fields.map((field) => [field, 0])));
    for (const field of fields) {
      const value = Number(row[field] ?? 0);
      if (Number.isFinite(value)) bucket[field] = Math.round((bucket[field] + value) * 1000) / 1000;
    }
  };
  const groups = new Map<string, ReportTotals>();
  const grand = blank("Grand total");
  for (const row of rows) {
    add(grand, row);
    if (grouping) {
      const label = groupLabel(row[grouping]);
      const group = groups.get(label) ?? blank(label);
      add(group, row);
      groups.set(label, group);
    }
  }
  return { fields, groups: Array.from(groups.values()), grand };
}

/** Splits selected fields into bands so a PDF prints every column instead of the first six. */
export function planColumnBands(fields: string[], perBand = 6): string[][] {
  const size = Math.max(1, perBand);
  const bands: string[][] = [];
  for (let index = 0; index < fields.length; index += size) bands.push(fields.slice(index, index + size));
  return bands.length ? bands : [[]];
}
