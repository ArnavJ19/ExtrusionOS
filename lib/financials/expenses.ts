import { z } from "zod";

// Client-side mirror of the database-owned expense rules in
// 20261020010000_expense_ledger_integrity.sql. The database remains authoritative;
// these helpers only keep forms, previews and buttons consistent with it.

export const EXPENSE_APPROVAL_THRESHOLD = 25000;
export const FINANCE_ROLES = ["owner", "admin", "accounts"] as const;
export const expenseCategories = [
  "raw_material", "scrap_purchase", "external_aluminium_source", "packaging_material", "spare_parts",
  "maintenance_repairs", "dies_tooling", "utilities", "fuel_oils", "chemicals", "freight_logistics",
  "labour_vendor_services", "office_and_administration", "production_consumables", "surface_treatment",
  "factory_overheads", "miscellaneous"
] as const;
export const supplierPaymentMethods = ["bank_transfer", "upi", "cheque", "cash", "other"] as const;
export const referenceRequiredMethods: readonly string[] = ["bank_transfer", "upi", "cheque"];

const PAISE = 100;
function toPaise(value: unknown) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return Number.NaN;
  // Round half away from zero at the paisa on the shortest decimal representation, matching
  // PostgreSQL round(numeric, 2). Binary scaling would turn 1.005 into 100.4999... paise.
  const text = String(number);
  if (/e/i.test(text)) return Math.sign(number) * Math.round(Math.abs(number) * PAISE);
  const negative = text.startsWith("-");
  const [whole, fraction = ""] = text.replace("-", "").split(".");
  const digits = `${fraction}000`.slice(0, 3);
  const paise = Number(whole) * PAISE + Number(digits.slice(0, 2)) + (Number(digits[2]) >= 5 ? 1 : 0);
  return negative ? -paise : paise;
}
export function roundMoney(value: unknown) {
  const paise = toPaise(value);
  return Number.isNaN(paise) ? Number.NaN : paise / PAISE;
}

export type ExpenseComponents = {
  quantity?: unknown;
  rate?: unknown;
  base_amount?: unknown;
  tax_amount?: unknown;
  freight_amount?: unknown;
  discount_amount?: unknown;
};

export type ExpenseTotals = { base: number; total: number; error: string | null };

export function deriveExpenseTotals(input: ExpenseComponents): ExpenseTotals {
  const quantity = Number(input.quantity ?? 0);
  const rate = roundMoney(input.rate);
  let base = roundMoney(input.base_amount);
  const tax = roundMoney(input.tax_amount);
  const freight = roundMoney(input.freight_amount);
  const discount = roundMoney(input.discount_amount);
  if ([quantity, rate, base, tax, freight, discount].some((value) => !Number.isFinite(value))) {
    return { base: 0, total: 0, error: "Expense amounts must be valid numbers." };
  }
  if (Math.min(quantity, rate, base, tax, freight, discount) < 0) {
    return { base: 0, total: 0, error: "Quantity, rate and amounts cannot be negative." };
  }
  if (quantity > 0 && rate > 0) {
    // Exact decimal product: quantity is held to 0.001 and rate to 0.01, as in the database.
    const product = Math.round(quantity * 1000) * toPaise(rate);
    const computed = Math.sign(product) * Math.round(Math.abs(product) / 1000) / PAISE;
    if (base === 0) base = computed;
    else if (Math.abs(base - computed) >= 0.005) {
      return { base, total: 0, error: `Base amount must equal quantity x rate (${computed.toFixed(2)}). Clear the rate to enter a lump-sum base.` };
    }
  }
  const total = (toPaise(base) + toPaise(tax) + toPaise(freight) - toPaise(discount)) / PAISE;
  if (total <= 0) return { base, total, error: "Expense total must be greater than zero." };
  return { base, total, error: null };
}

export type ExpenseSettlementInput = {
  total_amount?: unknown;
  amount_paid?: unknown;
  refunded_amount?: unknown;
  credited_amount?: unknown;
};

export function expenseSettlement(input: ExpenseSettlementInput) {
  const total = toPaise(input.total_amount);
  const paid = toPaise(input.amount_paid);
  const refunded = toPaise(input.refunded_amount);
  const credited = toPaise(input.credited_amount);
  const netPaid = paid - refunded;
  return {
    total: total / PAISE,
    paid: paid / PAISE,
    refunded: refunded / PAISE,
    credited: credited / PAISE,
    netPaid: netPaid / PAISE,
    balance: Math.max(total - netPaid - credited, 0) / PAISE,
    supplierCreditDue: Math.max(netPaid + credited - total, 0) / PAISE
  };
}

export function liveExpensePaymentStatus(status: string, balance: unknown, dueDate: string | null | undefined, asOf: string) {
  const open = roundMoney(balance) > 0;
  const due = dueDate ? dueDate.slice(0, 10) : null;
  if ((status === "unpaid" || status === "partially_paid") && open && due && due < asOf) return "overdue";
  if (status === "overdue" && (!open || !due || due >= asOf)) return "unpaid";
  return status;
}

export type ExpenseApprovalAction = "submit" | "approve" | "reject" | "reopen" | "cancel";

export type ExpenseActionContext = {
  role: string;
  approval_status: string;
  total_amount: unknown;
  source_table?: string | null;
  amount_paid?: unknown;
  refunded_amount?: unknown;
  credited_amount?: unknown;
  deleted_at?: string | null;
};

export function isFinanceRole(role: string) {
  return (FINANCE_ROLES as readonly string[]).includes(role);
}

export function canDecideExpense(role: string, total: unknown) {
  return role === "owner" || role === "admin" || (role === "accounts" && roundMoney(total) <= EXPENSE_APPROVAL_THRESHOLD);
}

export function availableExpenseActions(expense: ExpenseActionContext): ExpenseApprovalAction[] {
  if (!isFinanceRole(expense.role) || expense.deleted_at) return [];
  const settlement = expenseSettlement(expense);
  const hasSettlement = settlement.paid > 0 || settlement.credited > 0 || settlement.refunded > 0;
  const actions: ExpenseApprovalAction[] = [];
  const decide = canDecideExpense(expense.role, expense.total_amount);
  if (["draft", "rejected"].includes(expense.approval_status) && roundMoney(expense.total_amount) > 0) actions.push("submit");
  if (expense.approval_status === "pending_approval" && decide) actions.push("approve", "reject");
  if (expense.approval_status === "approved" && ["owner", "admin"].includes(expense.role) && !hasSettlement) actions.push("reopen");
  if (!expense.source_table && ["draft", "pending_approval", "rejected", "approved"].includes(expense.approval_status)
    && decide && settlement.netPaid <= 0) actions.push("cancel");
  return actions;
}

export function canEditManualExpense(expense: Pick<ExpenseActionContext, "approval_status" | "source_table" | "deleted_at">) {
  return !expense.source_table && !expense.deleted_at && ["draft", "pending_approval", "rejected"].includes(expense.approval_status);
}

export function canPayExpense(expense: Pick<ExpenseActionContext, "approval_status" | "deleted_at"> & { balance_amount?: unknown }) {
  return expense.approval_status === "approved" && !expense.deleted_at && roundMoney(expense.balance_amount) > 0;
}

const optionalText = z.string().trim().max(2000).optional().nullable().transform((value) => value || null);
const optionalUuid = z.union([z.string().uuid(), z.literal(""), z.null()]).optional().transform((value) => value || null);
const optionalDate = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date"), z.literal(""), z.null()]).optional()
  .transform((value) => value || null);
const money = (label: string) => z.coerce.number({ invalid_type_error: `${label} must be a number` })
  .finite(`${label} must be a finite number`).nonnegative(`${label} cannot be negative`).default(0);

export const manualExpenseInputSchema = z.object({
  expense_category: z.enum(expenseCategories, { errorMap: () => ({ message: "Select a valid expense category" }) }),
  expense_subcategory: optionalText,
  vendor_id: optionalUuid,
  description: z.string().trim().min(3, "Enter an expense description").max(2000),
  quantity: z.coerce.number().finite().nonnegative("Quantity cannot be negative").default(0),
  unit: optionalText,
  rate: money("Rate"),
  base_amount: money("Base amount"),
  tax_amount: money("Tax amount"),
  freight_amount: money("Freight amount"),
  discount_amount: money("Discount amount"),
  total_amount: z.union([z.coerce.number().finite(), z.literal(""), z.null()]).optional()
    .transform((value) => (value === "" || value == null ? null : Number(value))),
  currency: z.literal("INR", { errorMap: () => ({ message: "Expenses are recorded in INR. Convert the bill to INR at the booked rate." }) }).default("INR"),
  payment_method: optionalText,
  invoice_number: optionalText,
  invoice_date: optionalDate,
  due_date: optionalDate,
  cost_center: optionalText,
  department: optionalText,
  machine_id: optionalUuid,
  inventory_item_id: optionalUuid,
  notes: optionalText,
  submit: z.coerce.boolean().default(false)
}).superRefine((value, ctx) => {
  const totals = deriveExpenseTotals(value);
  if (totals.error) ctx.addIssue({ code: "custom", path: ["total_amount"], message: totals.error });
  else if (value.total_amount != null && Math.abs(value.total_amount - totals.total) >= 0.005) {
    ctx.addIssue({ code: "custom", path: ["total_amount"], message: `Total must equal base + tax + freight - discount (${totals.total.toFixed(2)}).` });
  }
  if (value.invoice_date && value.due_date && value.due_date < value.invoice_date) {
    ctx.addIssue({ code: "custom", path: ["due_date"], message: "Due date cannot be before the bill date." });
  }
});
export type ManualExpenseInput = z.input<typeof manualExpenseInputSchema>;

export const expensePaymentInputSchema = z.object({
  expense_id: z.string().uuid("Select an approved expense"),
  amount_paid: z.coerce.number().finite("Enter a valid amount").positive("Amount must be greater than zero"),
  payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Payment date is required"),
  payment_method: z.enum(supplierPaymentMethods, { errorMap: () => ({ message: "Select a valid payment method" }) }),
  bank_account: optionalText,
  reference_number: optionalText,
  notes: optionalText,
  idempotency_key: z.string().uuid()
}).superRefine((value, ctx) => {
  if (referenceRequiredMethods.includes(value.payment_method) && !value.reference_number) {
    ctx.addIssue({ code: "custom", path: ["reference_number"], message: "Reference number is required for bank, UPI and cheque payments." });
  }
});
export type ExpensePaymentInput = z.input<typeof expensePaymentInputSchema>;

export const supplierCreditInputSchema = z.object({
  expense_id: z.string().uuid(),
  credit_type: z.enum(["credit_note", "refund"]),
  amount: z.coerce.number().finite("Enter a valid amount").positive("Amount must be greater than zero"),
  credit_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date is required"),
  payment_method: z.enum(supplierPaymentMethods).optional().nullable(),
  reference_number: optionalText,
  reason: z.string().trim().min(5, "Enter a clear reason").max(1000),
  idempotency_key: z.string().uuid()
}).superRefine((value, ctx) => {
  if (value.credit_type === "credit_note" && !value.reference_number) {
    ctx.addIssue({ code: "custom", path: ["reference_number"], message: "Enter the supplier credit note number." });
  }
  if (value.credit_type === "refund") {
    if (!value.payment_method) ctx.addIssue({ code: "custom", path: ["payment_method"], message: "Select how the refund was received." });
    else if (referenceRequiredMethods.includes(value.payment_method) && !value.reference_number) {
      ctx.addIssue({ code: "custom", path: ["reference_number"], message: "Reference number is required for bank, UPI and cheque refunds." });
    }
  }
});
export type SupplierCreditInput = z.input<typeof supplierCreditInputSchema>;

export const expenseTransitionInputSchema = z.object({
  expense_id: z.string().uuid(),
  action: z.enum(["submit", "approve", "reject", "reopen", "cancel"]),
  note: z.string().trim().max(1000).optional().nullable()
}).superRefine((value, ctx) => {
  if (["reject", "reopen", "cancel"].includes(value.action) && (value.note ?? "").trim().length < 5) {
    ctx.addIssue({ code: "custom", path: ["note"], message: "Enter a clear reason (at least 5 characters)." });
  }
});

export const settlementReversalInputSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(5, "Enter a clear reversal reason").max(1000),
  idempotency_key: z.string().uuid()
});

export function expensePaymentRequestKey(input: Omit<ExpensePaymentInput, "idempotency_key">) {
  return JSON.stringify([input.expense_id, roundMoney(input.amount_paid), input.payment_date, input.payment_method,
    (input.bank_account ?? "").trim(), (input.reference_number ?? "").trim(), (input.notes ?? "").trim()]);
}

// Keep one retry key per unchanged submission; any edit to the payload starts a new key, so a
// lost response can be retried safely while a corrected payment is never mistaken for a replay.
export function nextIdempotentAttempt(
  previous: { requestKey: string; idempotencyKey: string } | null,
  requestKey: string,
  createKey: () => string
) {
  if (previous && previous.requestKey === requestKey) return previous;
  return { requestKey, idempotencyKey: createKey() };
}
