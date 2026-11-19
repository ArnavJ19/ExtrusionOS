import { PageHeader } from "@/components/layout/page-header";
import { QueryErrorNotice } from "@/components/ui/query-error-notice";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { getErrorMessage } from "@/lib/utils/errors";
import { CommandCenterClient } from "@/components/modules/command-center-client";
import { getBusinessDateBoundaries } from "@/lib/utils/business-date";
import { redirect } from "next/navigation";
import Link from "next/link";

// FS-132: every KPI figure on this page (booked revenue, receivables, collections, shipped kg, completed kg, scrap kg,
// recovery and the quote win rate) comes from public.fs_kpi, the one SQL definition the analytics and dashboard
// snapshots agree with (tests/fs-batch4-sql.test.mjs). The page itself only counts and lists records for attention.
type KpiItem = { value: number | null; numerator: number | null; denominator: number | null; status: string; note: string | null; jobs?: number; missing_jobs?: number };
type KpiValues = Record<string, KpiItem>;
const value = (k: KpiValues | null, key: string) => Number(k?.[key]?.value ?? 0);

export default async function CommandCenterPage() {
  const context = await getSessionContext();
  if (!["owner", "admin"].includes(context.role)) redirect("/dashboard");

  const supabase = await createClient();
  const { today, monthStart, lastMonthStart, lastMonthEnd } = getBusinessDateBoundaries(new Date());

  const activeProductionStages = [
    "order_confirmed", "die_ready", "billet_ready", "billet_heating", "extrusion_planned",
    "extruded", "stretching", "cutting", "aging", "surface_treatment", "finishing", "packing",
  ];

  const [
    kpiMonth, kpiLastMonth,
    monthlyQuotes, monthlyOrders, pendingQuotes, sentQuotes, convertedQuotes,
    activeProduction, plannedJobs, pendingDispatch, monthlyDispatches, delayedOrders,
    overdueInvoices, lowStockItems, totalInventoryItems, qualityHolds, qualityFails,
    dieCorrectionCount, dieInactiveCount, unreadAlerts, openTasks, urgentTasks,
    activeCustomers, recentOrders, topCustomers,
  ] = await Promise.all([
    supabase.rpc("fs_kpi", { p_command: "values", p_payload: { from: monthStart, to: today } }),
    supabase.rpc("fs_kpi", { p_command: "values", p_payload: { from: lastMonthStart, to: lastMonthEnd } }),
    // Quotes dated this month (pipeline value is the quoted value of these quotes)
    supabase.from("quotes_authorized").select("id, grand_total, status", { count: "exact" })
      .eq("company_id", context.companyId).gte("quote_date", monthStart).lte("quote_date", today),
    supabase.from("orders_authorized").select("id", { count: "exact", head: true })
      .eq("company_id", context.companyId).gte("order_date", monthStart).lte("order_date", today).neq("current_stage", "cancelled"),
    supabase.from("quotes_authorized").select("id", { count: "exact", head: true })
      .eq("company_id", context.companyId).in("status", ["draft", "internal_review", "approved_for_sending"]),
    supabase.from("quotes_authorized").select("id, grand_total", { count: "exact" })
      .eq("company_id", context.companyId).eq("status", "sent"),
    supabase.from("quotes_authorized").select("id", { count: "exact", head: true })
      .eq("company_id", context.companyId).eq("status", "converted_to_order").gte("quote_date", monthStart).lte("quote_date", today),
    supabase.from("orders_authorized").select("id", { count: "exact", head: true })
      .eq("company_id", context.companyId).in("current_stage", activeProductionStages),
    supabase.from("production_jobs").select("id, job_number, planned_quantity_kg, status, planned_date", { count: "exact" })
      .eq("company_id", context.companyId).in("status", ["planned", "ready"]).order("planned_date", { ascending: true }).limit(10),
    supabase.from("orders_authorized").select("id, order_number, customer_id, expected_dispatch_date, order_value, customer_name, company_name", { count: "exact" })
      .eq("company_id", context.companyId).not("current_stage", "in", "(dispatched,delivered,closed,cancelled)")
      .order("expected_dispatch_date", { ascending: true }).limit(10),
    supabase.from("dispatches").select("id", { count: "exact", head: true })
      .eq("company_id", context.companyId).gte("dispatch_date", monthStart).lte("dispatch_date", today)
      .not("delivery_status", "in", "(pending,returned,damaged)"),
    supabase.from("orders_authorized").select("id, order_number, expected_dispatch_date, order_value, customer_name, company_name")
      .eq("company_id", context.companyId).lt("expected_dispatch_date", today)
      .not("current_stage", "in", "(dispatched,delivered,closed,cancelled)")
      .order("expected_dispatch_date", { ascending: true }).limit(10),
    supabase.from("invoices").select("id, invoice_number, customer_id, grand_total, balance_due, due_date, status, customers(customer_name, company_name)")
      .eq("company_id", context.companyId).in("status", ["generated", "sent", "partially_paid", "overdue"])
      .lt("due_date", today).gt("balance_due", 0).order("due_date", { ascending: true }).limit(10),
    supabase.from("inventory_items").select("id, item_code, item_name, item_category, current_stock, reorder_level, unit")
      .eq("company_id", context.companyId).eq("is_active", true).order("current_stock", { ascending: true }).limit(100),
    supabase.from("inventory_items").select("id", { count: "exact", head: true }).eq("company_id", context.companyId).eq("is_active", true),
    supabase.from("quality_inspections").select("id", { count: "exact", head: true }).eq("company_id", context.companyId).in("status", ["rejected", "rework"]),
    supabase.from("quality_inspections").select("id, status").eq("company_id", context.companyId).gte("inspection_date", monthStart).lte("inspection_date", today),
    supabase.from("dies").select("id", { count: "exact", head: true }).eq("company_id", context.companyId).eq("die_status", "correction"),
    supabase.from("dies").select("id", { count: "exact", head: true }).eq("company_id", context.companyId).in("die_status", ["inactive", "dead"]),
    supabase.from("notifications").select("id, title, severity, notification_type, created_at", { count: "exact" })
      .eq("company_id", context.companyId).eq("is_read", false).order("created_at", { ascending: false }).limit(8),
    supabase.from("tasks").select("id, title, priority, status, due_date, assigned_to, task_type", { count: "exact" })
      .eq("company_id", context.companyId).in("status", ["open", "in_progress"]).order("due_date", { ascending: true }).limit(10),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("company_id", context.companyId).eq("priority", "urgent").in("status", ["open", "in_progress"]),
    supabase.from("orders_authorized").select("customer_id")
      .eq("company_id", context.companyId).gte("order_date", monthStart).lte("order_date", today).neq("current_stage", "cancelled"),
    supabase.from("orders_authorized").select("id, order_number, order_value, order_date, current_stage, priority, customer_name, company_name")
      .eq("company_id", context.companyId).order("order_date", { ascending: false }).limit(5),
    supabase.from("orders_authorized").select("customer_id, order_value, customer_name, company_name")
      .eq("company_id", context.companyId).gte("order_date", monthStart).lte("order_date", today).neq("current_stage", "cancelled"),
  ]);

  const k = (kpiMonth.data ?? null) as KpiValues | null;
  const kLast = (kpiLastMonth.data ?? null) as KpiValues | null;
  const recovery = k?.recovery;

  // Counts and lists for attention (not KPIs).
  const monthlyQuoteValue = (monthlyQuotes.data ?? []).reduce((s, q: any) => s + Number(q.grand_total ?? 0), 0);
  const sentQuoteValue = (sentQuotes.data ?? []).reduce((s, q: any) => s + Number(q.grand_total ?? 0), 0);
  const activeCustomerIds = new Set((activeCustomers.data ?? []).map((r: any) => r.customer_id).filter(Boolean));
  const lowStockFiltered = (lowStockItems.data ?? []).filter((item: any) => {
    const reorderLevel = Number(item.reorder_level ?? 0);
    return reorderLevel > 0 && Number(item.current_stock ?? 0) <= reorderLevel;
  });
  const totalInspected = (qualityFails.data ?? []).length;
  const failedInspections = (qualityFails.data ?? []).filter((q: any) => q.status === "rejected" || q.status === "rework").length;
  const customerMap = new Map<string, { name: string; value: number }>();
  (topCustomers.data ?? []).forEach((o: any) => {
    const name = o.company_name || o.customer_name || "Unknown";
    const existing = customerMap.get(o.customer_id) || { name, value: 0 };
    existing.value += Number(o.order_value ?? 0);
    customerMap.set(o.customer_id, existing);
  });
  const topCustomersList = Array.from(customerMap.values()).sort((a, b) => b.value - a.value).slice(0, 5);

  const monthlyOrderValue = value(k, "order_intake");
  const lastMonthOrderValue = value(kLast, "order_intake");
  const revenueGrowth = lastMonthOrderValue > 0 ? ((monthlyOrderValue - lastMonthOrderValue) / lastMonthOrderValue) * 100 : 0;
  const recoveryPercent = recovery?.status === "measured" && recovery.value !== null ? Number(recovery.value) : null;
  const winRate = k?.quote_win_rate?.status === "measured" ? Number(k.quote_win_rate.value) : 0;

  // Facts only: no targets are invented here (FS-77). Reorder levels and promise dates are the company's own.
  const insights: { text: string; severity: "info" | "warning" | "critical" | "success" }[] = [];
  if (lastMonthOrderValue > 0) insights.push({ text: `Booked revenue this month is ${Math.abs(revenueGrowth).toFixed(0)}% ${revenueGrowth >= 0 ? "above" : "below"} last month so far.`, severity: "info" });
  if (recovery?.status === "not_captured" && Number(recovery.missing_jobs ?? 0) > 0) insights.push({ text: `Recovery is not captured: ${recovery.missing_jobs} completed production job(s) have no issued billet input.`, severity: "warning" });
  if (lowStockFiltered.length > 0) insights.push({ text: `${lowStockFiltered.length} inventory item(s) at or below their reorder level.`, severity: "warning" });
  if ((delayedOrders.data ?? []).length > 0) insights.push({ text: `${(delayedOrders.data ?? []).length} order(s) past their expected dispatch date.`, severity: "critical" });
  if ((dieCorrectionCount.count ?? 0) > 0) insights.push({ text: `${dieCorrectionCount.count} die(s) in correction.`, severity: "warning" });
  if ((qualityHolds.count ?? 0) > 0) insights.push({ text: `${qualityHolds.count} quality hold(s) pending. Resolve before dispatch.`, severity: "critical" });
  if (topCustomersList.length > 0) insights.push({ text: `Top customer this month: ${topCustomersList[0].name} with ₹${(topCustomersList[0].value / 100000).toFixed(1)}L in orders.`, severity: "info" });

  const queryErrors = [
    kpiMonth, kpiLastMonth, monthlyQuotes, monthlyOrders, pendingQuotes, sentQuotes, convertedQuotes,
    activeProduction, plannedJobs, pendingDispatch, monthlyDispatches, delayedOrders, overdueInvoices,
    lowStockItems, totalInventoryItems, qualityHolds, qualityFails, dieCorrectionCount, dieInactiveCount,
    unreadAlerts, openTasks, urgentTasks, activeCustomers, recentOrders, topCustomers,
  ].map((r) => (r.error ? getErrorMessage(r.error) : "")).filter(Boolean);

  return (
    <div>
      <PageHeader
        title="Command Center"
        description="Owner-level view of revenue, production, dispatch, receivables, quality and inventory. Every KPI uses the KPI dictionary definition."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/insights/kpis" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-700 shadow-sm transition hover:border-orange hover:text-orange">KPI definitions</Link>
            <Link href="/dashboard" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-700 shadow-sm transition hover:border-orange hover:text-orange">Standard Dashboard</Link>
          </div>
        }
      />
      <QueryErrorNotice messages={queryErrors} />
      <CommandCenterClient
        metrics={{
          monthlyQuoteValue,
          monthlyQuoteCount: monthlyQuotes.count ?? 0,
          monthlyOrderValue,
          monthlyOrderCount: monthlyOrders.count ?? 0,
          lastMonthOrderValue,
          revenueGrowth,
          sentQuoteValue,
          sentQuoteCount: sentQuotes.count ?? 0,
          pendingQuoteCount: pendingQuotes.count ?? 0,
          convertedQuoteCount: convertedQuotes.count ?? 0,
          quoteConversionRate: winRate,
          activeProductionCount: activeProduction.count ?? 0,
          plannedJobCount: plannedJobs.count ?? 0,
          monthlyDispatchCount: monthlyDispatches.count ?? 0,
          dispatchWeight: value(k, "shipped_kg"),
          delayedOrderCount: (delayedOrders.data ?? []).length,
          pendingDispatchCount: pendingDispatch.count ?? 0,
          totalReceivableValue: value(k, "receivables_outstanding"),
          overdueInvoiceCount: (overdueInvoices.data ?? []).length,
          monthlyPaymentValue: value(k, "collections"),
          lowStockCount: lowStockFiltered.length,
          totalInventoryCount: totalInventoryItems.count ?? 0,
          totalProduced: value(k, "production_completed_kg"),
          totalScrap: value(k, "scrap_kg"),
          recoveryPercent,
          recoveryInputKg: Number(recovery?.denominator ?? 0),
          recoveryOutputKg: Number(recovery?.numerator ?? 0),
          recoveryCapturedJobCount: Math.max(0, Number(recovery?.jobs ?? 0) - Number(recovery?.missing_jobs ?? 0)),
          recoveryMissingJobCount: Number(recovery?.missing_jobs ?? 0),
          qualityHoldCount: qualityHolds.count ?? 0,
          totalInspected,
          failedInspections,
          dieCorrectionCount: dieCorrectionCount.count ?? 0,
          dieInactiveCount: dieInactiveCount.count ?? 0,
          unreadAlertCount: unreadAlerts.count ?? 0,
          openTaskCount: openTasks.count ?? 0,
          urgentTaskCount: urgentTasks.count ?? 0,
          activeCustomerCount: activeCustomerIds.size,
        }}
        delayedOrders={delayedOrders.data ?? []}
        overdueInvoices={overdueInvoices.data ?? []}
        lowStockItems={lowStockFiltered.slice(0, 8)}
        recentOrders={recentOrders.data ?? []}
        plannedJobs={plannedJobs.data ?? []}
        alerts={unreadAlerts.data ?? []}
        openTasks={openTasks.data ?? []}
        topCustomers={topCustomersList}
        insights={insights}
      />
    </div>
  );
}
