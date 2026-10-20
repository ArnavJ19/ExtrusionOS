import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { getAnalyticsEvidenceState, parseAdvancedAnalyticsSnapshot } from "@/lib/analytics/advanced-dashboard";
import { createClient } from "@/lib/supabase/server";
import { formatCompactCurrency, formatCurrency, formatDate, formatPercent } from "@/lib/utils/format";
import { labelize } from "@/types/app";
import { AlertTriangle, CheckCircle2, IndianRupee, TrendingUp, Truck } from "lucide-react";
import { redirect } from "next/navigation";

function pctClass(value: number, goodAbove = 80) {
  if (value >= goodAbove) return "text-emerald-700 bg-emerald-50 border-emerald-200";
  if (value >= goodAbove * 0.7) return "text-amber-700 bg-amber-50 border-amber-200";
  return "text-rose-700 bg-rose-50 border-rose-200";
}

function barWidth(value: number, max: number) {
  if (max <= 0) return "0%";
  return `${Math.max(0, Math.min(100, (value / max) * 100))}%`;
}

export default async function AnalyticsPage() {
  const context = await getSessionContext();
  if (!can(context.role, "read", "reports")) redirect("/dashboard");

  const supabase = await createClient();
  const now = new Date();
  const analyticsAsOf = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const analyticsResult = await supabase.rpc("get_advanced_analytics_snapshot" as any, {
    p_as_of: analyticsAsOf,
    p_months: 6,
  });
  const parsedSnapshot = parseAdvancedAnalyticsSnapshot(analyticsResult.data);
  const evidenceState = analyticsResult.error ? "unavailable" : getAnalyticsEvidenceState(parsedSnapshot, analyticsAsOf, now);
  const queryErrors = [
    analyticsResult.error ? `analytics: ${analyticsResult.error.message}` : null,
    !analyticsResult.error && !parsedSnapshot ? "analytics: database returned an invalid snapshot" : null,
  ].filter(Boolean) as string[];

  if (!parsedSnapshot || evidenceState === "unavailable" || evidenceState === "stale") return (
    <div className="space-y-6">
      <PageHeader title="Advanced Analytics" description="Business metrics require current, verified source data." />
      <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm font-semibold text-amber-800">
        Analytics {evidenceState === "stale" ? "is stale" : "is unavailable"}. Retry after the data source is restored. Metrics and risk conclusions cannot be established.
        {queryErrors.length ? <p className="mt-2">{analyticsResult.error ? "The database analytics query failed." : "The database returned an invalid snapshot."}</p> : null}
      </div>
    </div>
  );
  const snapshot = parsedSnapshot;
  // Snapshot 20261020 hides customer-level receivable and expense detail from non-finance roles.
  const financeDetail = snapshot.dataQuality?.financeDetail ?? true;

  const maxTrendValue = Math.max(
    1,
    ...snapshot.trends.flatMap((point) => [point.ordersValue, point.invoicedValue, point.expenseValue, point.collectionValue]),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Advanced Analytics"
        description={`Activity through ${analyticsAsOf} in Asia/Kolkata. Outstanding balances, order stages, inventory and tasks describe current state; they are not reconstructed historical balances.`}
      />

      {evidenceState === "partial" ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          Shipment evidence is partial: {snapshot.dataQuality?.unknownShipmentCount} activated records lack a verified movement timestamp or packing ledger. They are excluded from shipment totals. Resolve this evidence before concluding that shipment performance is healthy.
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 text-white">
          <CardContent>
            <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-300">Order Intake MTD</p>
            <p className="mt-3 text-3xl font-black">{formatCompactCurrency(snapshot.kpis.bookedRevenueMtd)}</p>
            <p className="mt-1 text-xs text-slate-300">{snapshot.kpis.activeOrders} active orders in pipeline</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="flex items-center justify-between">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Quote Conversion MTD</p>
              <TrendingUp className="h-4 w-4 text-emerald-600" />
            </div>
            <p className="mt-3 text-3xl font-black text-slate-900">{formatPercent(snapshot.kpis.quoteConversionRateMtd)}</p>
            <p className="mt-1 text-xs text-slate-500">Open pipeline {formatCompactCurrency(snapshot.kpis.quotePipelineValueMtd)}; includes prior-month quotes with current validity</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="flex items-center justify-between">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Dispatch Performance</p>
              <Truck className="h-4 w-4 text-cyan-600" />
            </div>
            <p className="mt-3 text-3xl font-black text-slate-900">{formatPercent(snapshot.kpis.dispatchOnTimeRate)}</p>
            <p className="mt-1 text-xs text-slate-500">{snapshot.kpis.delayedOrders} delayed orders; {snapshot.kpis.dispatchWeightMtd.toLocaleString("en-IN")} kg shipped MTD</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="flex items-center justify-between">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Cashflow Health</p>
              <IndianRupee className="h-4 w-4 text-blue-600" />
            </div>
            <p className="mt-3 text-3xl font-black text-slate-900">{formatCompactCurrency(snapshot.kpis.receivableOutstanding)}</p>
            <p className="mt-1 text-xs text-slate-500">{snapshot.kpis.overdueInvoices} overdue invoices</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Trend Grid</p>
              <h2 className="mt-1 text-lg font-black tracking-tight text-slate-950">6-Month Multi-Metric Trend</h2>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs font-black uppercase tracking-[0.14em] text-slate-500">
                    <th className="py-2 pr-4">Month</th>
                    <th className="py-2 pr-4">Orders</th>
                    <th className="py-2 pr-4">Gross invoiced</th>
                    <th className="py-2 pr-4">Collections</th>
                    <th className="py-2 pr-4">Expenses</th>
                    <th className="py-2">Dispatch kg</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.trends.map((row) => (
                    <tr key={row.key} className="border-b border-slate-100 align-top">
                      <td className="py-3 pr-4 font-bold text-slate-900">{row.label}</td>
                      <td className="py-3 pr-4">
                        <p className="font-bold text-slate-900">{formatCompactCurrency(row.ordersValue)}</p>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-indigo-500" style={{ width: barWidth(row.ordersValue, maxTrendValue) }} /></div>
                      </td>
                      <td className="py-3 pr-4">
                        <p className="font-bold text-slate-900">{formatCompactCurrency(row.invoicedValue)}</p>
                        {row.creditNoteValue ? <p className="text-xs font-semibold text-amber-700">Credit notes {formatCompactCurrency(row.creditNoteValue)}</p> : null}
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-500" style={{ width: barWidth(row.invoicedValue, maxTrendValue) }} /></div>
                      </td>
                      <td className="py-3 pr-4">
                        <p className="font-bold text-emerald-700">{formatCompactCurrency(row.collectionValue)}</p>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: barWidth(row.collectionValue, maxTrendValue) }} /></div>
                      </td>
                      <td className="py-3 pr-4">
                        <p className="font-bold text-rose-700">{formatCompactCurrency(row.expenseValue)}</p>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-rose-500" style={{ width: barWidth(row.expenseValue, maxTrendValue) }} /></div>
                      </td>
                      <td className="py-3 font-bold text-slate-700">{Math.round(row.dispatchWeight).toLocaleString("en-IN")} kg</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Risk Radar</p>
              <h2 className="mt-1 text-lg font-black tracking-tight text-slate-950">Priority Alerts</h2>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {snapshot.risks.length ? (
                snapshot.risks.map((risk) => (
                  <div key={risk} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <p>{risk}</p>
                    </div>
                  </div>
                ))
              ) : evidenceState === "verified" ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                    <p>No critical risk signals from current data.</p>
                  </div>
                </div>
              ) : <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">Risk assessment is incomplete until shipment evidence is reconciled.</div>}
            </div>
            <div className="mt-4 grid gap-2">
              <div className={`rounded-xl border px-3 py-2 text-xs font-bold ${pctClass(snapshot.kpis.productionAttainmentPctMtd, 90)}`}>
                Production attainment: {formatPercent(snapshot.kpis.productionAttainmentPctMtd)}
              </div>
              {financeDetail ? <div className={`rounded-xl border px-3 py-2 text-xs font-bold ${pctClass(snapshot.kpis.expensePaidRateMtd, 70)}`}>
                Booked expense payment coverage: {formatPercent(snapshot.kpis.expensePaidRateMtd)}
              </div> : null}
              <div className={`rounded-xl border px-3 py-2 text-xs font-bold ${pctClass(snapshot.kpis.qualityPassRateMtd, 92)}`}>
                QC decision pass rate: {formatPercent(snapshot.kpis.qualityPassRateMtd)}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-4">
        <Card>
          <CardContent>
            <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Production Against MTD Plan</p>
            <p className="mt-2 text-2xl font-black text-slate-900">{Math.round(snapshot.kpis.productionActualKgMtd).toLocaleString("en-IN")} kg</p>
            <p className="mt-1 text-xs text-slate-500">Plan through the as-of date: {Math.round(snapshot.kpis.productionPlannedKgMtd).toLocaleString("en-IN")} kg. Actual counts jobs completed through that date.</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Gross Invoiced MTD</p>
            <p className="mt-2 text-2xl font-black text-slate-900">{formatCompactCurrency(snapshot.kpis.invoicedValueMtd)}</p>
            {snapshot.kpis.netInvoicedMtd !== undefined ? <p className="mt-1 text-xs text-slate-500">Credit notes {formatCompactCurrency(snapshot.kpis.creditNotesMtd ?? 0)}; net billed {formatCompactCurrency(snapshot.kpis.netInvoicedMtd)}</p> : null}
            <p className="mt-1 text-xs text-slate-500">Cash collections (net of refunds): {formatCompactCurrency(snapshot.kpis.collectionsMtd)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{financeDetail ? "Booked Expense MTD (INR)" : "Customer Credit"}</p>
            {financeDetail ? <>
              <p className="mt-2 text-2xl font-black text-slate-900">{formatCompactCurrency(snapshot.kpis.expenseRunRateMtd)}</p>
              <p className="mt-1 text-xs text-slate-500">Approved spend only. Paid ratio: {formatPercent(snapshot.kpis.expensePaidRateMtd)}</p>
              {snapshot.kpis.expenseCommitments !== undefined ? <p className="mt-1 text-xs text-slate-500">Pending approval: {formatCompactCurrency(snapshot.kpis.expenseCommitments)}</p> : null}
              {snapshot.expenseByCurrency?.filter((row) => row.currency !== "INR").map((row) => <p key={row.currency} className="mt-1 text-xs font-semibold text-amber-700">{row.currency} {row.bookedMtd.toLocaleString("en-IN")} booked separately ({row.count} bills)</p>)}
            </> : <p className="mt-2 text-sm font-semibold text-slate-500">Expense and customer-level receivable detail is available to finance roles.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Task Heat</p>
            <p className="mt-2 text-2xl font-black text-slate-900">{snapshot.kpis.openTasks}</p>
            <p className="mt-1 text-xs text-slate-500">{snapshot.kpis.urgentOpenTasks} urgent/high priority</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Commercial Focus</p>
              <h2 className="mt-1 text-lg font-black tracking-tight text-slate-950">Top Customers by Booked Value</h2>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {snapshot.topCustomers.length ? snapshot.topCustomers.map((customer, index) => (
                <div key={customer.customerId ?? `unknown-${index}`} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-slate-900">#{index + 1} {customer.name}</p>
                    <p className="mt-0.5 text-xs font-semibold text-slate-500">Account {customer.customerId?.slice(0, 8) ?? "unlinked"} / {customer.orderCount} orders</p>
                  </div>
                  <p className="text-sm font-black text-slate-900">{formatCurrency(customer.value)}</p>
                </div>
              )) : <div className="rounded-xl border border-dashed border-slate-200 p-4 text-sm font-semibold text-slate-500">No customer booking data yet.</div>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Operational Flow</p>
              <h2 className="mt-1 text-lg font-black tracking-tight text-slate-950">Stage Bottleneck Map</h2>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {snapshot.stageBacklog.length ? snapshot.stageBacklog.map((stage) => (
                <div key={stage.stage} className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-slate-900">{labelize(stage.stage)}</p>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-orange" style={{ width: barWidth(stage.count, Math.max(1, snapshot.kpis.activeOrders)) }} />
                    </div>
                  </div>
                  <p className="text-sm font-black text-slate-900">{stage.count}</p>
                </div>
              )) : <div className="rounded-xl border border-dashed border-slate-200 p-4 text-sm font-semibold text-slate-500">No active stage backlog.</div>}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Receivables Control</p>
              <h2 className="mt-1 text-lg font-black tracking-tight text-slate-950">Overdue Invoice Queue</h2>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs font-black uppercase tracking-[0.14em] text-slate-500">
                    <th className="py-2 pr-3">Invoice</th>
                    <th className="py-2 pr-3">Customer</th>
                    <th className="py-2 pr-3">Due</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.overdueInvoiceList.length ? snapshot.overdueInvoiceList.map((invoice) => (
                    <tr key={invoice.invoiceNumber} className="border-b border-slate-100">
                      <td className="py-3 pr-3 font-black text-slate-900">{invoice.invoiceNumber}</td>
                      <td className="py-3 pr-3 text-slate-700">{invoice.customer}</td>
                      <td className="py-3 pr-3 text-slate-700">{formatDate(invoice.dueDate)}</td>
                      <td className="py-3 pr-3 text-xs font-bold text-rose-700">{labelize(invoice.status)}</td>
                      <td className="py-3 text-right font-black text-rose-700">{formatCurrency(invoice.balanceDue)}</td>
                    </tr>
                  )) : <tr><td colSpan={5} className="py-6 text-center text-sm font-semibold text-slate-500">{financeDetail ? "No overdue invoices." : `${snapshot.kpis.overdueInvoices} overdue invoices. Invoice-level detail is available to finance roles.`}</td></tr>}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {financeDetail && snapshot.customerCreditList ? <Card>
          <CardHeader>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Customer Credit Follow-up</p>
              <h2 className="mt-1 text-lg font-black tracking-tight text-slate-950">Refunds and Credits Due: {formatCurrency(snapshot.kpis.customerCreditDue ?? 0)}</h2>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {snapshot.customerCreditList.length ? snapshot.customerCreditList.map((row) => (
                <div key={row.invoiceNumber} className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <div className="min-w-0"><p className="truncate text-sm font-black text-slate-900">{row.invoiceNumber}</p><p className="text-xs font-semibold text-slate-600">{row.customer} / {labelize(row.status)}</p></div>
                  <div className="text-right"><p className="text-sm font-black text-amber-800">{formatCurrency(row.creditDue)}</p>{row.invoiceId ? <a className="text-xs font-semibold text-slate-700 underline" href={`/invoices/${row.invoiceId}`}>Record refund</a> : null}</div>
                </div>
              )) : <div className="rounded-xl border border-dashed border-slate-200 p-4 text-sm font-semibold text-slate-500">No customer refunds or credits are due.</div>}
            </div>
          </CardContent>
        </Card> : null}

        <Card>
          <CardHeader>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Inventory Risk</p>
              <h2 className="mt-1 text-lg font-black tracking-tight text-slate-950">Low-Stock and Reorder Pressure</h2>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {snapshot.lowStock.length ? snapshot.lowStock.map((item) => (
                <div key={`${item.itemCode}-${item.itemName}`} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-slate-900">{item.itemCode} - {item.itemName}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        Current {item.currentStock.toLocaleString("en-IN")} {item.unit} / Reorder {item.reorderLevel.toLocaleString("en-IN")} {item.unit}
                      </p>
                    </div>
                    <div className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-black text-rose-700">
                      {formatPercent(item.shortagePct)}
                    </div>
                  </div>
                </div>
              )) : <div className="rounded-xl border border-dashed border-slate-200 p-4 text-sm font-semibold text-slate-500">No low-stock items flagged.</div>}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Dispatch</p>
              <p className="mt-1 text-sm font-black text-slate-900">{snapshot.kpis.dispatchWeightMtd.toLocaleString("en-IN")} kg MTD</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Quality</p>
              <p className="mt-1 text-sm font-black text-slate-900">{formatPercent(snapshot.kpis.qualityPassRateMtd)} pass rate MTD</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Inventory</p>
              <p className="mt-1 text-sm font-black text-slate-900">{snapshot.kpis.inventoryAtRiskCount} at risk / {snapshot.kpis.inventoryOutOfStockCount} out of stock</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Tasks</p>
              <p className="mt-1 text-sm font-black text-slate-900">{snapshot.kpis.openTasks} open / {snapshot.kpis.urgentOpenTasks} urgent-high</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
