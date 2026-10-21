import { z } from "zod";
import { getBusinessDateBoundaries } from "../utils/business-date.ts";

type MaybeDate = string | null | undefined;
type MaybeNumber = number | string | null | undefined;

export type AnalyticsOrderRow = {
  id: string;
  customer_id?: string | null;
  order_date?: MaybeDate;
  order_value?: MaybeNumber;
  current_stage?: string | null;
  expected_dispatch_date?: MaybeDate;
  customers?: { company_name?: string | null; customer_name?: string | null } | null;
};

export type AnalyticsQuoteRow = {
  id: string;
  status?: string | null;
  grand_total?: MaybeNumber;
  quote_date?: MaybeDate;
  created_at?: MaybeDate;
  valid_until?: MaybeDate;
};

export type AnalyticsProductionRow = {
  id: string;
  status?: string | null;
  planned_date?: MaybeDate;
  completed_at?: MaybeDate;
  planned_quantity_kg?: MaybeNumber;
  actual_quantity_kg?: MaybeNumber;
};

export type AnalyticsDispatchRow = {
  id: string;
  dispatch_date?: MaybeDate;
  total_weight_kg?: MaybeNumber;
  delivery_status?: string | null;
  actual_dispatched_at?: MaybeDate;
  movement_weight_kg?: MaybeNumber;
  orders?: { expected_dispatch_date?: MaybeDate } | null;
};

export type AnalyticsInvoiceRow = {
  id: string;
  invoice_number?: string | null;
  invoice_date?: MaybeDate;
  due_date?: MaybeDate;
  status?: string | null;
  grand_total?: MaybeNumber;
  balance_due?: MaybeNumber;
  amount_paid?: MaybeNumber;
  paid_date?: MaybeDate;
  customers?: { company_name?: string | null; customer_name?: string | null } | null;
};

export type AnalyticsPaymentRow = {
  event_id: string;
  payment_date?: MaybeDate;
  amount?: MaybeNumber;
};

export type AnalyticsExpenseRow = {
  id: string;
  total_amount?: MaybeNumber;
  amount_paid?: MaybeNumber;
  payment_status?: string | null;
  approval_status?: string | null;
  currency?: string | null;
  refunded_amount?: MaybeNumber;
  deleted_at?: MaybeDate;
  created_at?: MaybeDate;
  invoice_date?: MaybeDate;
  paid_date?: MaybeDate;
};

export type AnalyticsQualityRow = {
  id: string;
  status?: string | null;
  quantity_checked_kg?: MaybeNumber;
  inspection_date?: MaybeDate;
  created_at?: MaybeDate;
};

export type AnalyticsInventoryRow = {
  id: string;
  is_active?: boolean | null;
  item_code?: string | null;
  item_name?: string | null;
  unit?: string | null;
  current_stock?: MaybeNumber;
  reorder_level?: MaybeNumber;
};

export type AnalyticsTaskRow = {
  id: string;
  status?: string | null;
  priority?: string | null;
  due_date?: MaybeDate;
};

export type AnalyticsInput = {
  orders: AnalyticsOrderRow[];
  quotes: AnalyticsQuoteRow[];
  productionJobs: AnalyticsProductionRow[];
  dispatches: AnalyticsDispatchRow[];
  invoices: AnalyticsInvoiceRow[];
  payments: AnalyticsPaymentRow[];
  expenses: AnalyticsExpenseRow[];
  qualityInspections: AnalyticsQualityRow[];
  inventoryItems: AnalyticsInventoryRow[];
  tasks: AnalyticsTaskRow[];
};

export type AnalyticsTrendPoint = {
  key: string;
  label: string;
  ordersValue: number;
  dispatchWeight: number;
  invoicedValue: number;
  creditNoteValue?: number;
  expenseValue: number;
  collectionValue: number;
};

export type AdvancedAnalyticsSnapshot = {
  kpis: {
    bookedRevenueMtd: number;
    quotePipelineValueMtd: number;
    quoteConversionRateMtd: number;
    activeOrders: number;
    delayedOrders: number;
    dispatchWeightMtd: number;
    dispatchOnTimeRate: number;
    productionPlannedKgMtd: number;
    productionActualKgMtd: number;
    productionAttainmentPctMtd: number;
    receivableOutstanding: number;
    overdueInvoices: number;
    invoicedValueMtd: number;
    creditNotesMtd?: number;
    netInvoicedMtd?: number;
    collectionsMtd: number;
    customerCreditDue?: number;
    customerCreditDueCount?: number;
    expenseRunRateMtd: number;
    expensePaidRateMtd: number;
    expenseCommitments?: number;
    expenseNonInrCountMtd?: number;
    qualityPassRateMtd: number;
    inventoryAtRiskCount: number;
    inventoryOutOfStockCount: number;
    openTasks: number;
    urgentOpenTasks: number;
  };
  trends: AnalyticsTrendPoint[];
  topCustomers: { customerId?: string | null; name: string; orderCount: number; value: number }[];
  stageBacklog: { stage: string; count: number }[];
  lowStock: { itemCode: string; itemName: string; unit: string; currentStock: number; reorderLevel: number; shortagePct: number }[];
  overdueInvoiceList: { invoiceNumber: string; customer: string; dueDate: string | null; balanceDue: number; status: string }[];
  customerCreditList?: { invoiceId?: string | null; invoiceNumber: string; customer: string; creditDue: number; status: string }[];
  expenseByCurrency?: { currency: string; bookedMtd: number; count: number }[];
  risks: string[];
  dataQuality?: { version: string; asOf: string; generatedAt: string; currentStateAt: string; unknownShipmentCount: number; financeDetail?: boolean };
};

export const SUPPORTED_ANALYTICS_VERSIONS = ["20261008", "20261020"] as const;
const analyticsNumber = z.union([z.number(), z.string().min(1)]).pipe(z.coerce.number().finite());
const advancedAnalyticsSnapshotSchema = z.object({
  kpis: z.object({
    bookedRevenueMtd: analyticsNumber,
    quotePipelineValueMtd: analyticsNumber,
    quoteConversionRateMtd: analyticsNumber,
    activeOrders: analyticsNumber,
    delayedOrders: analyticsNumber,
    dispatchWeightMtd: analyticsNumber,
    dispatchOnTimeRate: analyticsNumber,
    productionPlannedKgMtd: analyticsNumber,
    productionActualKgMtd: analyticsNumber,
    productionAttainmentPctMtd: analyticsNumber,
    receivableOutstanding: analyticsNumber,
    overdueInvoices: analyticsNumber,
    invoicedValueMtd: analyticsNumber,
    creditNotesMtd: analyticsNumber.optional(),
    netInvoicedMtd: analyticsNumber.optional(),
    collectionsMtd: analyticsNumber,
    customerCreditDue: analyticsNumber.optional(),
    customerCreditDueCount: analyticsNumber.optional(),
    expenseRunRateMtd: analyticsNumber,
    expensePaidRateMtd: analyticsNumber,
    expenseCommitments: analyticsNumber.optional(),
    expenseNonInrCountMtd: analyticsNumber.optional(),
    qualityPassRateMtd: analyticsNumber,
    inventoryAtRiskCount: analyticsNumber,
    inventoryOutOfStockCount: analyticsNumber,
    openTasks: analyticsNumber,
    urgentOpenTasks: analyticsNumber,
  }),
  trends: z.array(z.object({
    key: z.string(),
    label: z.string(),
    ordersValue: analyticsNumber,
    dispatchWeight: analyticsNumber,
    invoicedValue: analyticsNumber,
    creditNoteValue: analyticsNumber.optional(),
    expenseValue: analyticsNumber,
    collectionValue: analyticsNumber,
  })),
  topCustomers: z.array(z.object({
    customerId: z.string().nullable().optional(),
    name: z.string(),
    orderCount: analyticsNumber,
    value: analyticsNumber,
  })),
  stageBacklog: z.array(z.object({
    stage: z.string(),
    count: analyticsNumber,
  })),
  lowStock: z.array(z.object({
    itemCode: z.string(),
    itemName: z.string(),
    unit: z.string(),
    currentStock: analyticsNumber,
    reorderLevel: analyticsNumber,
    shortagePct: analyticsNumber,
  })),
  overdueInvoiceList: z.array(z.object({
    invoiceNumber: z.string(),
    customer: z.string(),
    dueDate: z.string().nullable(),
    balanceDue: analyticsNumber,
    status: z.string(),
  })),
  customerCreditList: z.array(z.object({
    invoiceId: z.string().nullable().optional(),
    invoiceNumber: z.string(),
    customer: z.string(),
    creditDue: analyticsNumber,
    status: z.string(),
  })).optional(),
  expenseByCurrency: z.array(z.object({
    currency: z.string(),
    bookedMtd: analyticsNumber,
    count: analyticsNumber,
  })).optional(),
  risks: z.array(z.string()),
  dataQuality: z.object({
    // 20261020 adds gross/net invoicing, booked-spend rules and finance-only detail.
    version: z.enum(SUPPORTED_ANALYTICS_VERSIONS),
    asOf: z.string(),
    generatedAt: z.string().datetime({ offset: true }),
    currentStateAt: z.string().datetime({ offset: true }),
    unknownShipmentCount: z.number().int().nonnegative(),
    financeDetail: z.boolean().optional(),
  }).optional(),
});

export function parseAdvancedAnalyticsSnapshot(value: unknown): AdvancedAnalyticsSnapshot | null {
  const parsed = advancedAnalyticsSnapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function getAnalyticsEvidenceState(snapshot: AdvancedAnalyticsSnapshot | null, asOf: string, now = new Date()) {
  const quality = snapshot?.dataQuality;
  if (!quality || !(SUPPORTED_ANALYTICS_VERSIONS as readonly string[]).includes(quality.version) || quality.asOf !== asOf) return "unavailable";
  const ages = [quality.generatedAt, quality.currentStateAt].map((time) => now.getTime() - new Date(time).getTime());
  if (ages.some((age) => !Number.isFinite(age) || age < -60_000 || age > 15 * 60_000)) return "stale";
  return quality.unknownShipmentCount > 0 ? "partial" : "verified";
}

const CLOSED_ORDER_STAGES = new Set(["delivered", "closed", "cancelled"]);
const CONVERTED_QUOTE_STATUSES = new Set(["converted_to_order"]);
const OPEN_PIPELINE_QUOTE_STATUSES = new Set(["approved_for_sending", "sent", "customer_approved"]);
const ISSUED_INVOICE_STATUSES = new Set(["generated", "sent", "partially_paid", "paid", "overdue"]);
const OPEN_INVOICE_STATUSES = new Set(["generated", "sent", "partially_paid", "overdue"]);

export function toNumber(value: MaybeNumber) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function safePercent(numerator: number, denominator: number) {
  if (!Number.isFinite(numerator) || numerator <= 0) return 0;
  if (!Number.isFinite(denominator) || denominator <= 0) return 0;
  return (numerator / denominator) * 100;
}

function validDate(value: MaybeDate) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function monthKey(date: Date) { return getBusinessDateBoundaries(date).today.slice(0, 7); }

function monthLabel(date: Date) {
  return date.toLocaleString("en-IN", { month: "short", year: "2-digit", timeZone: "Asia/Kolkata" });
}

function dateBefore(dateValue: MaybeDate, boundary: Date) {
  const date = businessDate(dateValue);
  return date !== null && date < getBusinessDateBoundaries(boundary).today;
}

function trendAxis(now: Date, months: number) {
  const axis: { key: string; label: string }[] = [];
  const [year, month] = getBusinessDateBoundaries(now).today.split("-").map(Number);
  for (let i = months - 1; i >= 0; i -= 1) {
    const cursor = new Date(Date.UTC(year, month - i - 1, 1, 12));
    axis.push({ key: monthKey(cursor), label: monthLabel(cursor) });
  }
  return axis;
}

function groupByMonth<T>(rows: T[], getDate: (row: T) => MaybeDate, getValue: (row: T) => number, axisKeys: string[], asOf: string) {
  const map = new Map<string, number>();
  for (const key of axisKeys) map.set(key, 0);
  for (const row of rows) {
    const date = validDate(getDate(row));
    if (!date) continue;
    if (businessDate(getDate(row))! > asOf) continue;
    const key = monthKey(date);
    if (!map.has(key)) continue;
    map.set(key, (map.get(key) ?? 0) + getValue(row));
  }
  return map;
}

function businessDate(value: MaybeDate): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = validDate(value);
  return date ? getBusinessDateBoundaries(date).today : null;
}

function customerLabel(order: AnalyticsOrderRow) {
  return order.customers?.company_name || order.customers?.customer_name || "Unknown Customer";
}

export function isBookedExpense(expense: Pick<AnalyticsExpenseRow, "approval_status">) {
  return expense.approval_status === "approved" || expense.approval_status === "paid";
}

export function buildAdvancedAnalyticsSnapshot(input: AnalyticsInput, now = new Date()): AdvancedAnalyticsSnapshot {
  const { today, monthStart: monthStartDate } = getBusinessDateBoundaries(now);
  const throughAsOf = (value: MaybeDate) => { const date = businessDate(value); return date !== null && date <= today; };
  const inMtd = (value: MaybeDate) => throughAsOf(value) && businessDate(value)! >= monthStartDate;
  const axis = trendAxis(now, 6);
  const axisKeys = axis.map((point) => point.key);

  const activeOrders = input.orders.filter((order) => !CLOSED_ORDER_STAGES.has(String(order.current_stage ?? "")) && (!order.order_date || throughAsOf(order.order_date)));
  const delayedOrders = activeOrders.filter((order) => dateBefore(order.expected_dispatch_date, now));
  const ordersMtd = input.orders.filter((order) => inMtd(order.order_date) && String(order.current_stage ?? "") !== "cancelled");

  const quoteMtd = input.quotes.filter((quote) => inMtd(quote.quote_date ?? quote.created_at));
  const quotePipelineValueMtd = input.quotes
    .filter((quote) => throughAsOf(quote.quote_date ?? quote.created_at) && OPEN_PIPELINE_QUOTE_STATUSES.has(String(quote.status ?? "")) && (!quote.valid_until || businessDate(quote.valid_until)! >= today))
    .reduce((sum, quote) => sum + toNumber(quote.grand_total), 0);
  const quoteEligibleMtd = quoteMtd.filter((quote) => !["draft", "internal_review"].includes(String(quote.status ?? "")));
  const quoteConvertedMtd = quoteEligibleMtd.filter((quote) => CONVERTED_QUOTE_STATUSES.has(String(quote.status ?? "")));

  const verifiedDispatches = input.dispatches.filter((dispatch) => dispatch.delivery_status && dispatch.delivery_status !== "pending" && dispatch.actual_dispatched_at && toNumber(dispatch.movement_weight_kg) > 0);
  // KPI dictionary: shipped kg excludes returned and damaged shipments.
  const shippedDispatches = verifiedDispatches.filter((dispatch) => !["returned", "damaged"].includes(String(dispatch.delivery_status)));
  const dispatchesMtd = verifiedDispatches.filter((dispatch) => inMtd(dispatch.actual_dispatched_at));
  const shippedMtd = shippedDispatches.filter((dispatch) => inMtd(dispatch.actual_dispatched_at));
  const dispatchDecisionMtd = dispatchesMtd.filter((dispatch) => Boolean(dispatch.orders?.expected_dispatch_date));
  const onTimeDispatchesMtd = dispatchDecisionMtd.filter((dispatch) => {
    const actualDate = businessDate(dispatch.actual_dispatched_at);
    const promisedDate = String(dispatch.orders?.expected_dispatch_date ?? "").slice(0, 10);
    return Boolean(actualDate && promisedDate && actualDate <= promisedDate);
  });

  const plannedProductionMtd = input.productionJobs.filter((job) => inMtd(job.planned_date) && String(job.status ?? "") !== "cancelled");
  const completedProductionMtd = input.productionJobs.filter((job) => String(job.status ?? "") === "completed" && inMtd(job.completed_at));
  const productionPlannedKgMtd = plannedProductionMtd.reduce((sum, job) => sum + toNumber(job.planned_quantity_kg), 0);
  const productionActualKgMtd = completedProductionMtd.reduce((sum, job) => sum + toNumber(job.actual_quantity_kg), 0);
  // KPI dictionary: attainment compares the same job set (jobs planned this month).
  const productionPlannedJobsActualKgMtd = plannedProductionMtd
    .filter((job) => String(job.status ?? "") === "completed")
    .reduce((sum, job) => sum + toNumber(job.actual_quantity_kg), 0);

  const invoiceMtd = input.invoices.filter((invoice) => (
    ISSUED_INVOICE_STATUSES.has(String(invoice.status ?? "")) && inMtd(invoice.invoice_date)
  ));
  const invoicedValueMtd = invoiceMtd.reduce((sum, invoice) => sum + toNumber(invoice.grand_total), 0);
  const collectionsMtd = input.payments
    .filter((payment) => inMtd(payment.payment_date))
    .reduce((sum, payment) => sum + toNumber(payment.amount), 0);

  const receivableOutstanding = input.invoices
    .filter((invoice) => OPEN_INVOICE_STATUSES.has(String(invoice.status ?? "")))
    .reduce((sum, invoice) => sum + toNumber(invoice.balance_due), 0);
  const overdueInvoices = input.invoices
    .filter((invoice) => OPEN_INVOICE_STATUSES.has(String(invoice.status ?? "")) && toNumber(invoice.balance_due) > 0 && dateBefore(invoice.due_date, now))
    .sort((a, b) => toNumber(b.balance_due) - toNumber(a.balance_due));
  const overdueInvoiceList = overdueInvoices
    .slice(0, 8)
    .map((invoice) => ({
      invoiceNumber: invoice.invoice_number || invoice.id.slice(0, 8),
      customer: invoice.customers?.company_name || invoice.customers?.customer_name || "Unknown Customer",
      dueDate: invoice.due_date ?? null,
      balanceDue: toNumber(invoice.balance_due),
      status: String(invoice.status ?? "sent"),
    }));

  // Booked spend mirrors get_advanced_analytics_snapshot 20261020: approved, undeleted INR only.
  const liveExpenses = input.expenses.filter((expense) => !expense.deleted_at && (expense.currency ?? "INR") === "INR");
  const expenseMtd = liveExpenses.filter((expense) => isBookedExpense(expense) && inMtd(expense.invoice_date ?? expense.created_at));
  const expenseRunRateMtd = expenseMtd.reduce((sum, expense) => sum + toNumber(expense.total_amount), 0);
  const expensePaidMtd = expenseMtd.reduce((sum, expense) => sum + toNumber(expense.amount_paid) - toNumber(expense.refunded_amount), 0);
  const expenseCommitments = liveExpenses.filter((expense) => expense.approval_status === "pending_approval")
    .reduce((sum, expense) => sum + toNumber(expense.total_amount), 0);

  const qualityMtd = input.qualityInspections.filter((inspection) => inMtd(inspection.inspection_date ?? inspection.created_at));
  const qualityApprovedMtd = qualityMtd.filter((inspection) => String(inspection.status ?? "") === "approved");
  const qualityDecisionMtd = qualityMtd.filter((inspection) => ["approved", "rejected", "rework"].includes(String(inspection.status ?? "")));

  const activeInventoryItems = input.inventoryItems.filter((item) => item.is_active !== false);
  const atRiskInventory = activeInventoryItems
    .map((item) => {
      const currentStock = toNumber(item.current_stock);
      const reorderLevel = toNumber(item.reorder_level);
      return {
        itemCode: item.item_code || "-",
        itemName: item.item_name || "-",
        unit: item.unit || "unit",
        currentStock,
        reorderLevel,
        shortagePct: reorderLevel > 0 ? Math.max(0, ((reorderLevel - currentStock) / reorderLevel) * 100) : 0,
      };
    })
    .filter((item) => item.reorderLevel > 0 && item.currentStock <= item.reorderLevel)
    .sort((a, b) => b.shortagePct - a.shortagePct);
  const lowStock = atRiskInventory
    .slice(0, 10);

  const openTasks = input.tasks.filter((task) => ["open", "in_progress"].includes(String(task.status ?? "")));
  const urgentOpenTasks = openTasks.filter((task) => ["urgent", "high"].includes(String(task.priority ?? "")));

  const customerTotals = new Map<string, { customerId: string | null; name: string; orderCount: number; value: number }>();
  for (const order of input.orders) {
    if (String(order.current_stage ?? "") === "cancelled") continue;
    if (!throughAsOf(order.order_date)) continue;
    const label = customerLabel(order);
    const key = order.customer_id ?? `unlinked-${order.id}`;
    const existing = customerTotals.get(key) ?? { orderCount: 0, value: 0 };
    customerTotals.set(key, {
      customerId: order.customer_id ?? null,
      name: label,
      orderCount: existing.orderCount + 1,
      value: existing.value + toNumber(order.order_value),
    });
  }
  const topCustomers = [...customerTotals.values()]
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  const stageCountMap = new Map<string, number>();
  for (const order of activeOrders) {
    const stage = String(order.current_stage ?? "order_confirmed");
    stageCountMap.set(stage, (stageCountMap.get(stage) ?? 0) + 1);
  }
  const stageBacklog = [...stageCountMap.entries()]
    .map(([stage, count]) => ({ stage, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const ordersByMonth = groupByMonth(input.orders.filter((row) => row.current_stage !== "cancelled"), (row) => row.order_date, (row) => toNumber(row.order_value), axisKeys, today);
  const dispatchByMonth = groupByMonth(shippedDispatches, (row) => row.actual_dispatched_at, (row) => toNumber(row.movement_weight_kg), axisKeys, today);
  const invoiceByMonth = groupByMonth(input.invoices.filter((row) => ISSUED_INVOICE_STATUSES.has(String(row.status))), (row) => row.invoice_date, (row) => toNumber(row.grand_total), axisKeys, today);
  const expenseByMonth = groupByMonth(liveExpenses.filter(isBookedExpense), (row) => row.invoice_date ?? row.created_at, (row) => toNumber(row.total_amount), axisKeys, today);
  const collectionByMonth = groupByMonth(input.payments, (row) => row.payment_date, (row) => toNumber(row.amount), axisKeys, today);

  const trends = axis.map((point) => ({
    key: point.key,
    label: point.label,
    ordersValue: ordersByMonth.get(point.key) ?? 0,
    dispatchWeight: dispatchByMonth.get(point.key) ?? 0,
    invoicedValue: invoiceByMonth.get(point.key) ?? 0,
    expenseValue: expenseByMonth.get(point.key) ?? 0,
    collectionValue: collectionByMonth.get(point.key) ?? 0,
  }));

  const risks: string[] = [];
  if (delayedOrders.length > 0) risks.push(`${delayedOrders.length} delayed orders need dispatch recovery.`);
  if (overdueInvoices.length > 0) risks.push(`${overdueInvoices.length} overdue invoices need receivable follow-up.`);
  if (atRiskInventory.length > 0) risks.push(`${atRiskInventory.length} inventory items are at or below reorder level.`);
  if (urgentOpenTasks.length > 0) risks.push(`${urgentOpenTasks.length} urgent/high-priority tasks are still open.`);
  if (productionPlannedKgMtd > 0 && safePercent(productionPlannedJobsActualKgMtd, productionPlannedKgMtd) < 85) {
    risks.push("Production attainment is below 85% of monthly plan.");
  }

  return {
    kpis: {
      bookedRevenueMtd: ordersMtd.reduce((sum, order) => sum + toNumber(order.order_value), 0),
      quotePipelineValueMtd,
      quoteConversionRateMtd: safePercent(quoteConvertedMtd.length, quoteEligibleMtd.length),
      activeOrders: activeOrders.length,
      delayedOrders: delayedOrders.length,
      dispatchWeightMtd: shippedMtd.reduce((sum, dispatch) => sum + toNumber(dispatch.movement_weight_kg), 0),
      dispatchOnTimeRate: safePercent(onTimeDispatchesMtd.length, dispatchDecisionMtd.length),
      productionPlannedKgMtd,
      productionActualKgMtd,
      productionAttainmentPctMtd: safePercent(productionPlannedJobsActualKgMtd, productionPlannedKgMtd),
      receivableOutstanding,
      overdueInvoices: overdueInvoices.length,
      invoicedValueMtd,
      collectionsMtd,
      expenseRunRateMtd,
      expensePaidRateMtd: safePercent(expensePaidMtd, expenseRunRateMtd),
      expenseCommitments,
      qualityPassRateMtd: safePercent(qualityApprovedMtd.length, qualityDecisionMtd.length),
      inventoryAtRiskCount: atRiskInventory.length,
      inventoryOutOfStockCount: activeInventoryItems.filter((item) => toNumber(item.current_stock) <= 0).length,
      openTasks: openTasks.length,
      urgentOpenTasks: urgentOpenTasks.length,
    },
    trends,
    topCustomers,
    stageBacklog,
    lowStock,
    overdueInvoiceList,
    risks,
  };
}
