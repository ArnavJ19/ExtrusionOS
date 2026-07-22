import test from "node:test";
import assert from "node:assert/strict";
import { buildAdvancedAnalyticsSnapshot, parseAdvancedAnalyticsSnapshot, safePercent, toNumber } from "../lib/analytics/advanced-dashboard.ts";

test("toNumber safely normalizes null, undefined, and invalid numeric values", () => {
  assert.equal(toNumber(null), 0);
  assert.equal(toNumber(undefined), 0);
  assert.equal(toNumber(""), 0);
  assert.equal(toNumber("abc"), 0);
  assert.equal(toNumber("125.5"), 125.5);
});

test("safePercent returns 0 when denominator is zero or invalid", () => {
  assert.equal(safePercent(10, 0), 0);
  assert.equal(safePercent(0, 10), 0);
  assert.equal(safePercent(10, -5), 0);
  assert.equal(safePercent(5, 20), 25);
});

test("advanced analytics snapshot handles empty datasets without throwing", () => {
  const snapshot = buildAdvancedAnalyticsSnapshot({
    orders: [],
    quotes: [],
    productionJobs: [],
    dispatches: [],
    invoices: [],
    payments: [],
    expenses: [],
    qualityInspections: [],
    inventoryItems: [],
    tasks: [],
  }, new Date("2026-06-01T00:00:00.000Z"));

  assert.equal(snapshot.kpis.bookedRevenueMtd, 0);
  assert.equal(snapshot.kpis.activeOrders, 0);
  assert.equal(snapshot.kpis.receivableOutstanding, 0);
  assert.equal(snapshot.kpis.overdueInvoices, 0);
  assert.equal(snapshot.kpis.inventoryAtRiskCount, 0);
  assert.equal(snapshot.kpis.openTasks, 0);
  assert.equal(snapshot.trends.length, 6);
});

test("advanced analytics snapshot computes conversion, delay, receivable, and risk edge cases", () => {
  const now = new Date("2026-06-15T00:00:00.000Z");

  const snapshot = buildAdvancedAnalyticsSnapshot({
    orders: [
      {
        id: "o1",
        order_date: "2026-06-05",
        order_value: 200000,
        current_stage: "extrusion_planned",
        expected_dispatch_date: "2026-06-10",
        customers: { company_name: "Apex Fabricators" },
      },
      {
        id: "o2",
        order_date: "2026-06-02",
        order_value: 150000,
        current_stage: "delivered",
        expected_dispatch_date: "2026-06-08",
        customers: { company_name: "Apex Fabricators" },
      },
      {
        id: "o3",
        order_date: "2026-05-20",
        order_value: 100000,
        current_stage: "packing",
        expected_dispatch_date: "2026-06-01",
        customers: { company_name: "Skyline Projects" },
      },
    ],
    quotes: [
      { id: "q1", status: "sent", grand_total: 90000, quote_date: "2026-06-03" },
      { id: "q2", status: "converted_to_order", grand_total: 120000, quote_date: "2026-06-04" },
      { id: "q3", status: "internal_review", grand_total: 45000, quote_date: "2026-06-08" },
      { id: "q4", status: "draft", grand_total: 25000, quote_date: "2026-06-09" },
      { id: "q5", status: "customer_approved", grand_total: 30000, quote_date: "2026-06-10" },
    ],
    productionJobs: [
      { id: "p1", status: "completed", planned_date: "2026-06-07", planned_quantity_kg: 1000, actual_quantity_kg: 900 },
      { id: "p2", status: "in_progress", planned_date: "2026-06-09", planned_quantity_kg: 500, actual_quantity_kg: 300 },
    ],
    dispatches: [
      { id: "d1", dispatch_date: "2026-06-09", total_weight_kg: 700, delivery_status: "delivered", orders: { expected_dispatch_date: "2026-06-10" } },
      { id: "d2", dispatch_date: "2026-06-11", total_weight_kg: 450, delivery_status: "delayed", orders: { expected_dispatch_date: "2026-06-10" } },
    ],
    invoices: [
      {
        id: "i1",
        invoice_number: "INV-001",
        invoice_date: "2026-06-06",
        due_date: "2026-06-12",
        status: "sent",
        grand_total: 180000,
        balance_due: 60000,
        amount_paid: 120000,
        paid_date: "2026-06-10",
        customers: { company_name: "Apex Fabricators" },
      },
      {
        id: "i2",
        invoice_number: "INV-002",
        invoice_date: "2026-05-22",
        due_date: "2026-06-01",
        status: "overdue",
        grand_total: 90000,
        balance_due: 90000,
        amount_paid: 0,
        customers: { company_name: "Skyline Projects" },
      },
    ],
    payments: [
      { event_id: "pay1", payment_date: "2026-06-10", amount: 120000 },
      { event_id: "pay2", payment_date: "2026-05-30", amount: 25000 },
    ],
    expenses: [
      { id: "e1", total_amount: 50000, amount_paid: 20000, payment_status: "partially_paid", approval_status: "approved", invoice_date: "2026-06-03" },
      { id: "e2", total_amount: 30000, amount_paid: 0, payment_status: "unpaid", approval_status: "pending_approval", invoice_date: "2026-06-04" },
    ],
    qualityInspections: [
      { id: "qi1", status: "approved", inspection_date: "2026-06-05", quantity_checked_kg: 400 },
      { id: "qi2", status: "rejected", inspection_date: "2026-06-06", quantity_checked_kg: 50 },
    ],
    inventoryItems: [
      { id: "it1", item_code: "PR-001", item_name: "Profile A", unit: "kg", current_stock: 80, reorder_level: 100 },
      { id: "it2", item_code: "PR-002", item_name: "Profile B", unit: "kg", current_stock: 0, reorder_level: 50 },
      { id: "it3", item_code: "PR-003", item_name: "Profile C", unit: "kg", current_stock: 300, reorder_level: 100 },
      { id: "it4", item_code: "PR-004", item_name: "Unmonitored item", unit: "kg", current_stock: 0, reorder_level: 0 },
    ],
    tasks: [
      { id: "t1", status: "open", priority: "urgent", due_date: "2026-06-16" },
      { id: "t2", status: "in_progress", priority: "high", due_date: "2026-06-18" },
      { id: "t3", status: "completed", priority: "normal", due_date: "2026-06-10" },
    ],
  }, now);

  assert.equal(snapshot.kpis.bookedRevenueMtd, 350000);
  assert.equal(snapshot.kpis.activeOrders, 2);
  assert.equal(snapshot.kpis.delayedOrders, 2);
  assert.equal(snapshot.kpis.quotePipelineValueMtd, 120000);
  assert.ok(Math.abs(snapshot.kpis.quoteConversionRateMtd - (100 / 3)) < 0.000001);
  assert.equal(snapshot.kpis.dispatchOnTimeRate, 50);
  assert.equal(snapshot.kpis.productionAttainmentPctMtd, 80);
  assert.equal(snapshot.kpis.receivableOutstanding, 150000);
  assert.equal(snapshot.kpis.overdueInvoices, 2);
  assert.equal(snapshot.kpis.collectionsMtd, 120000);
  assert.equal(snapshot.kpis.expenseRunRateMtd, 80000);
  assert.equal(snapshot.kpis.expensePaidRateMtd, 25);
  assert.equal(snapshot.kpis.qualityPassRateMtd, 50);
  assert.equal(snapshot.kpis.inventoryAtRiskCount, 2);
  assert.equal(snapshot.kpis.inventoryOutOfStockCount, 2);
  assert.equal(snapshot.kpis.openTasks, 2);
  assert.equal(snapshot.kpis.urgentOpenTasks, 2);

  assert.equal(snapshot.topCustomers[0].name, "Apex Fabricators");
  assert.equal(snapshot.lowStock[0].itemCode, "PR-002");
  assert.equal(snapshot.lowStock.some((item) => item.itemCode === "PR-004"), false);
  assert.equal(snapshot.overdueInvoiceList[0].invoiceNumber, "INV-002");
  assert.ok(snapshot.risks.length >= 4);
});

test("dashboard queue limits do not undercount lifetime risk totals", () => {
  const overdueInvoices = Array.from({ length: 12 }, (_, index) => ({
    id: `invoice-${index}`,
    invoice_number: `INV-${index}`,
    due_date: "2026-05-01",
    status: "overdue",
    balance_due: 1000 + index,
  }));
  const lowInventory = Array.from({ length: 15 }, (_, index) => ({
    id: `item-${index}`,
    item_code: `ITEM-${index}`,
    item_name: `Item ${index}`,
    unit: "kg",
    current_stock: index,
    reorder_level: 100,
  }));

  const snapshot = buildAdvancedAnalyticsSnapshot({
    orders: [],
    quotes: [],
    productionJobs: [],
    dispatches: [],
    invoices: overdueInvoices,
    payments: [],
    expenses: [],
    qualityInspections: [],
    inventoryItems: lowInventory,
    tasks: [],
  }, new Date("2026-06-15T00:00:00.000Z"));

  assert.equal(snapshot.kpis.overdueInvoices, 12);
  assert.equal(snapshot.overdueInvoiceList.length, 8);
  assert.equal(snapshot.kpis.inventoryAtRiskCount, 15);
  assert.equal(snapshot.lowStock.length, 10);
  assert.ok(snapshot.risks.includes("12 overdue invoices need receivable follow-up."));
  assert.ok(snapshot.risks.includes("15 inventory items are at or below reorder level."));
});

test("RPC snapshot parsing rejects incomplete payloads instead of crashing the dashboard", () => {
  assert.equal(parseAdvancedAnalyticsSnapshot({ kpis: {} }), null);
  assert.equal(parseAdvancedAnalyticsSnapshot(null), null);

  const empty = buildAdvancedAnalyticsSnapshot({
    orders: [], quotes: [], productionJobs: [], dispatches: [], invoices: [],
    payments: [], expenses: [], qualityInspections: [], inventoryItems: [], tasks: [],
  }, new Date("2026-06-15T00:00:00.000Z"));
  const parsed = parseAdvancedAnalyticsSnapshot({
    ...empty,
    kpis: { ...empty.kpis, bookedRevenueMtd: "125000.50" },
  });

  assert.equal(parsed?.kpis.bookedRevenueMtd, 125000.5);
  assert.equal(parsed?.trends.length, 6);
});
