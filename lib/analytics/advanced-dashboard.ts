type MaybeDate = string | null | undefined;
type MaybeNumber = number | string | null | undefined;

export type AnalyticsOrderRow = {
  id: string;
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
};

export type AnalyticsProductionRow = {
  id: string;
  status?: string | null;
  planned_date?: MaybeDate;
  planned_quantity_kg?: MaybeNumber;
  actual_quantity_kg?: MaybeNumber;
};

export type AnalyticsDispatchRow = {
  id: string;
  dispatch_date?: MaybeDate;
  total_weight_kg?: MaybeNumber;
  delivery_status?: string | null;
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

export type AnalyticsExpenseRow = {
  id: string;
  total_amount?: MaybeNumber;
  payment_status?: string | null;
  approval_status?: string | null;
  created_at?: MaybeDate;
  invoice_date?: MaybeDate;
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
    collectionsMtd: number;
    expenseRunRateMtd: number;
    expensePaidRateMtd: number;
    qualityPassRateMtd: number;
    inventoryAtRiskCount: number;
    inventoryOutOfStockCount: number;
    openTasks: number;
    urgentOpenTasks: number;
  };
  trends: AnalyticsTrendPoint[];
  topCustomers: { name: string; orderCount: number; value: number }[];
  stageBacklog: { stage: string; count: number }[];
  lowStock: { itemCode: string; itemName: string; unit: string; currentStock: number; reorderLevel: number; shortagePct: number }[];
  overdueInvoiceList: { invoiceNumber: string; customer: string; dueDate: string | null; balanceDue: number; status: string }[];
  risks: string[];
};

const CLOSED_ORDER_STAGES = new Set(["delivered", "closed", "cancelled"]);
const CONVERTED_QUOTE_STATUSES = new Set(["converted_to_order", "customer_approved"]);
const OPEN_INVOICE_STATUSES = new Set(["draft", "generated", "sent", "partially_paid", "overdue"]);

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

function monthKey(date: Date) {
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  return `${date.getFullYear()}-${m}`;
}

function monthLabel(date: Date) {
  return date.toLocaleString("en-IN", { month: "short", year: "2-digit" });
}

function monthStart(now: Date) {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function dateOnOrAfter(dateValue: MaybeDate, boundary: Date) {
  const date = validDate(dateValue);
  if (!date) return false;
  return date >= boundary;
}

function dateBefore(dateValue: MaybeDate, boundary: Date) {
  const date = validDate(dateValue);
  if (!date) return false;
  return date < boundary;
}

function trendAxis(now: Date, months: number) {
  const axis: { key: string; label: string }[] = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const cursor = new Date(now.getFullYear(), now.getMonth() - i, 1);
    axis.push({ key: monthKey(cursor), label: monthLabel(cursor) });
  }
  return axis;
}

function groupByMonth<T>(rows: T[], getDate: (row: T) => MaybeDate, getValue: (row: T) => number, axisKeys: string[]) {
  const map = new Map<string, number>();
  for (const key of axisKeys) map.set(key, 0);
  for (const row of rows) {
    const date = validDate(getDate(row));
    if (!date) continue;
    const key = monthKey(date);
    if (!map.has(key)) continue;
    map.set(key, (map.get(key) ?? 0) + getValue(row));
  }
  return map;
}

function customerLabel(order: AnalyticsOrderRow) {
  return order.customers?.company_name || order.customers?.customer_name || "Unknown Customer";
}

export function buildAdvancedAnalyticsSnapshot(input: AnalyticsInput, now = new Date()): AdvancedAnalyticsSnapshot {
  const startOfMonth = monthStart(now);
  const axis = trendAxis(now, 6);
  const axisKeys = axis.map((point) => point.key);

  const activeOrders = input.orders.filter((order) => !CLOSED_ORDER_STAGES.has(String(order.current_stage ?? "")));
  const delayedOrders = activeOrders.filter((order) => dateBefore(order.expected_dispatch_date, now));
  const ordersMtd = input.orders.filter((order) => dateOnOrAfter(order.order_date, startOfMonth) && String(order.current_stage ?? "") !== "cancelled");

  const quoteMtd = input.quotes.filter((quote) => dateOnOrAfter(quote.quote_date ?? quote.created_at, startOfMonth));
  const quotePipelineValueMtd = quoteMtd
    .filter((quote) => !["customer_rejected", "expired"].includes(String(quote.status ?? "")))
    .reduce((sum, quote) => sum + toNumber(quote.grand_total), 0);
  const quoteEligibleMtd = quoteMtd.filter((quote) => !["draft", "internal_review"].includes(String(quote.status ?? "")));
  const quoteConvertedMtd = quoteEligibleMtd.filter((quote) => CONVERTED_QUOTE_STATUSES.has(String(quote.status ?? "")));

  const dispatchesMtd = input.dispatches.filter((dispatch) => dateOnOrAfter(dispatch.dispatch_date, startOfMonth));
  const deliveredDispatchesMtd = dispatchesMtd.filter((dispatch) => String(dispatch.delivery_status ?? "") === "delivered");
  const delayedDispatchesMtd = dispatchesMtd.filter((dispatch) => String(dispatch.delivery_status ?? "") === "delayed");
  const dispatchDecisionMtd = deliveredDispatchesMtd.length + delayedDispatchesMtd.length;

  const productionMtd = input.productionJobs.filter((job) => dateOnOrAfter(job.planned_date, startOfMonth) && String(job.status ?? "") !== "cancelled");
  const productionPlannedKgMtd = productionMtd.reduce((sum, job) => sum + toNumber(job.planned_quantity_kg), 0);
  const productionActualKgMtd = productionMtd.reduce((sum, job) => sum + toNumber(job.actual_quantity_kg), 0);

  const invoiceMtd = input.invoices.filter((invoice) => dateOnOrAfter(invoice.invoice_date, startOfMonth));
  const invoicedValueMtd = invoiceMtd.reduce((sum, invoice) => sum + toNumber(invoice.grand_total), 0);
  const collectionsMtd = input.invoices
    .filter((invoice) => dateOnOrAfter(invoice.paid_date ?? invoice.invoice_date, startOfMonth))
    .reduce((sum, invoice) => sum + toNumber(invoice.amount_paid), 0);

  const receivableOutstanding = input.invoices
    .filter((invoice) => String(invoice.status ?? "") !== "cancelled")
    .reduce((sum, invoice) => sum + toNumber(invoice.balance_due), 0);
  const overdueInvoiceList = input.invoices
    .filter((invoice) => OPEN_INVOICE_STATUSES.has(String(invoice.status ?? "")) && toNumber(invoice.balance_due) > 0 && dateBefore(invoice.due_date, now))
    .sort((a, b) => toNumber(b.balance_due) - toNumber(a.balance_due))
    .slice(0, 8)
    .map((invoice) => ({
      invoiceNumber: invoice.invoice_number || invoice.id.slice(0, 8),
      customer: invoice.customers?.company_name || invoice.customers?.customer_name || "Unknown Customer",
      dueDate: invoice.due_date ?? null,
      balanceDue: toNumber(invoice.balance_due),
      status: String(invoice.status ?? "sent"),
    }));

  const expenseMtd = input.expenses.filter((expense) => dateOnOrAfter(expense.invoice_date ?? expense.created_at, startOfMonth));
  const expenseRunRateMtd = expenseMtd.reduce((sum, expense) => sum + toNumber(expense.total_amount), 0);
  const expensePaidMtd = expenseMtd
    .filter((expense) => ["paid", "partially_paid"].includes(String(expense.payment_status ?? "")))
    .reduce((sum, expense) => sum + toNumber(expense.total_amount), 0);

  const qualityMtd = input.qualityInspections.filter((inspection) => dateOnOrAfter(inspection.inspection_date ?? inspection.created_at, startOfMonth));
  const qualityApprovedMtd = qualityMtd.filter((inspection) => String(inspection.status ?? "") === "approved");
  const qualityDecisionMtd = qualityMtd.filter((inspection) => ["approved", "rejected", "rework"].includes(String(inspection.status ?? "")));

  const lowStock = input.inventoryItems
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
    .filter((item) => item.currentStock <= item.reorderLevel)
    .sort((a, b) => b.shortagePct - a.shortagePct)
    .slice(0, 10);

  const openTasks = input.tasks.filter((task) => ["open", "in_progress"].includes(String(task.status ?? "")));
  const urgentOpenTasks = openTasks.filter((task) => ["urgent", "high"].includes(String(task.priority ?? "")));

  const customerTotals = new Map<string, { orderCount: number; value: number }>();
  for (const order of input.orders) {
    if (String(order.current_stage ?? "") === "cancelled") continue;
    const label = customerLabel(order);
    const existing = customerTotals.get(label) ?? { orderCount: 0, value: 0 };
    customerTotals.set(label, {
      orderCount: existing.orderCount + 1,
      value: existing.value + toNumber(order.order_value),
    });
  }
  const topCustomers = [...customerTotals.entries()]
    .map(([name, value]) => ({ name, orderCount: value.orderCount, value: value.value }))
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

  const ordersByMonth = groupByMonth(input.orders, (row) => row.order_date, (row) => toNumber(row.order_value), axisKeys);
  const dispatchByMonth = groupByMonth(input.dispatches, (row) => row.dispatch_date, (row) => toNumber(row.total_weight_kg), axisKeys);
  const invoiceByMonth = groupByMonth(input.invoices, (row) => row.invoice_date, (row) => toNumber(row.grand_total), axisKeys);
  const expenseByMonth = groupByMonth(input.expenses, (row) => row.invoice_date ?? row.created_at, (row) => toNumber(row.total_amount), axisKeys);
  const collectionByMonth = groupByMonth(input.invoices, (row) => row.paid_date ?? row.invoice_date, (row) => toNumber(row.amount_paid), axisKeys);

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
  if (overdueInvoiceList.length > 0) risks.push(`${overdueInvoiceList.length} overdue invoices need receivable follow-up.`);
  if (lowStock.length > 0) risks.push(`${lowStock.length} inventory items are at or below reorder level.`);
  if (urgentOpenTasks.length > 0) risks.push(`${urgentOpenTasks.length} urgent/high-priority tasks are still open.`);
  if (productionPlannedKgMtd > 0 && safePercent(productionActualKgMtd, productionPlannedKgMtd) < 85) {
    risks.push("Production attainment is below 85% of monthly plan.");
  }

  return {
    kpis: {
      bookedRevenueMtd: ordersMtd.reduce((sum, order) => sum + toNumber(order.order_value), 0),
      quotePipelineValueMtd,
      quoteConversionRateMtd: safePercent(quoteConvertedMtd.length, quoteEligibleMtd.length),
      activeOrders: activeOrders.length,
      delayedOrders: delayedOrders.length,
      dispatchWeightMtd: dispatchesMtd.reduce((sum, dispatch) => sum + toNumber(dispatch.total_weight_kg), 0),
      dispatchOnTimeRate: safePercent(deliveredDispatchesMtd.length, dispatchDecisionMtd),
      productionPlannedKgMtd,
      productionActualKgMtd,
      productionAttainmentPctMtd: safePercent(productionActualKgMtd, productionPlannedKgMtd),
      receivableOutstanding,
      overdueInvoices: overdueInvoiceList.length,
      invoicedValueMtd,
      collectionsMtd,
      expenseRunRateMtd,
      expensePaidRateMtd: safePercent(expensePaidMtd, expenseRunRateMtd),
      qualityPassRateMtd: safePercent(qualityApprovedMtd.length, qualityDecisionMtd.length),
      inventoryAtRiskCount: lowStock.length,
      inventoryOutOfStockCount: input.inventoryItems.filter((item) => toNumber(item.current_stock) <= 0).length,
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

