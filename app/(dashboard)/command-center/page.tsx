import { PageHeader } from "@/components/layout/page-header";
import { QueryErrorNotice } from "@/components/ui/query-error-notice";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { getErrorMessage } from "@/lib/utils/errors";
import { CommandCenterClient } from "@/components/modules/command-center-client";
import { calculateIssuedBilletRecovery } from "@/lib/command-center/metrics";
import { getBusinessDateBoundaries } from "@/lib/utils/business-date";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function CommandCenterPage() {
  const context = await getSessionContext();
  if (!["owner", "admin"].includes(context.role)) redirect("/dashboard");

  const supabase = await createClient();
  const now = new Date();
  const { today, monthStart, lastMonthStart, lastMonthEnd, monthStartIso, tomorrowStartIso } = getBusinessDateBoundaries(now);

  const activeProductionStages = [
    "order_confirmed", "die_ready", "billet_ready", "billet_heating", "extrusion_planned",
    "extruded", "stretching", "cutting", "aging", "surface_treatment", "finishing", "packing",
  ];

  // Execute all queries in parallel for maximum performance
  const [
    // Sales & Revenue
    monthlyQuotes,
    monthlyOrders,
    lastMonthOrders,
    pendingQuotes,
    sentQuotes,
    convertedQuotes,

    // Production
    activeProduction,
    plannedJobs,

    // Dispatch
    pendingDispatch,
    monthlyDispatches,
    delayedOrders,

    // Receivables / Financial
    overdueInvoices,
    monthlyPayments,
    totalReceivables,

    // Inventory
    lowStockItems,
    totalInventoryItems,

    // Quality
    qualityHolds,
    qualityFails,

    // Dies
    dieCorrectionCount,
    dieInactiveCount,

    // Alerts & Tasks
    unreadAlerts,
    openTasks,
    urgentTasks,

    // Customers
    activeCustomers,
    recentOrders,
    topCustomers,

    // Scrap & Completed Production
    productionJobsCompleted,
    scrapRecordsMonthly,
  ] = await Promise.all([
    // Monthly quotes
    supabase.from("quotes").select("id, grand_total, status", { count: "exact" })
      .eq("company_id", context.companyId).gte("quote_date", monthStart).lte("quote_date", today),
    // Monthly orders
    supabase.from("orders").select("id, order_value, current_stage", { count: "exact" })
      .eq("company_id", context.companyId).gte("order_date", monthStart).lte("order_date", today).neq("current_stage", "cancelled"),
    // Last month orders
    supabase.from("orders").select("id, order_value", { count: "exact" })
      .eq("company_id", context.companyId).gte("order_date", lastMonthStart).lte("order_date", lastMonthEnd).neq("current_stage", "cancelled"),
    // Pending quotes (draft/review)
    supabase.from("quotes").select("id", { count: "exact", head: true })
      .eq("company_id", context.companyId).in("status", ["draft", "internal_review", "approved_for_sending"]),
    // Sent quotes
    supabase.from("quotes").select("id, grand_total", { count: "exact" })
      .eq("company_id", context.companyId).eq("status", "sent"),
    // Converted quotes
    supabase.from("quotes").select("id", { count: "exact", head: true })
      .eq("company_id", context.companyId).eq("status", "converted_to_order").gte("quote_date", monthStart).lte("quote_date", today),

    // Active production orders
    supabase.from("orders").select("id", { count: "exact", head: true })
      .eq("company_id", context.companyId).in("current_stage", activeProductionStages),
    // Planned production jobs
    supabase.from("production_jobs").select("id, job_number, planned_quantity_kg, status, planned_date", { count: "exact" })
      .eq("company_id", context.companyId).in("status", ["planned", "ready"]).order("planned_date", { ascending: true }).limit(10),
    // Pending dispatch
    supabase.from("orders").select("id, order_number, customer_id, expected_dispatch_date, order_value, customers(customer_name, company_name)", { count: "exact" })
      .eq("company_id", context.companyId).not("current_stage", "in", "(dispatched,delivered,closed,cancelled)")
      .order("expected_dispatch_date", { ascending: true }).limit(10),
    // Monthly dispatches
    supabase.from("dispatches").select("id, total_weight_kg", { count: "exact" })
      .eq("company_id", context.companyId).gte("dispatch_date", monthStart).lte("dispatch_date", today),
    // Delayed orders
    supabase.from("orders").select("id, order_number, expected_dispatch_date, order_value, customers(customer_name, company_name)")
      .eq("company_id", context.companyId).lt("expected_dispatch_date", today)
      .not("current_stage", "in", "(dispatched,delivered,closed,cancelled)")
      .order("expected_dispatch_date", { ascending: true }).limit(10),

    // Overdue invoices
    supabase.from("invoices").select("id, invoice_number, customer_id, grand_total, balance_due, due_date, status, customers(customer_name, company_name)")
      .eq("company_id", context.companyId).in("status", ["sent", "partially_paid", "overdue"])
      .lt("due_date", today).gt("balance_due", 0).order("due_date", { ascending: true }).limit(10),
    // Monthly payments
    supabase.rpc("get_financial_collection_events", { p_start_date: monthStart }),
    // Total receivables
    supabase.from("invoices").select("id, balance_due")
      .eq("company_id", context.companyId).in("status", ["sent", "partially_paid", "overdue"]).gt("balance_due", 0),

    // Low stock
    supabase.from("inventory_items").select("id, item_code, item_name, item_category, current_stock, reorder_level, unit")
      .eq("company_id", context.companyId).eq("is_active", true)
      .order("current_stock", { ascending: true }).limit(100),
    // Total inventory count
    supabase.from("inventory_items").select("id", { count: "exact", head: true })
      .eq("company_id", context.companyId).eq("is_active", true),

    // Quality holds
    supabase.from("quality_inspections").select("id", { count: "exact", head: true })
      .eq("company_id", context.companyId).in("status", ["rejected", "rework"]),
    // Quality fails this month
    supabase.from("quality_inspections").select("id, status, quantity_checked_kg")
      .eq("company_id", context.companyId).gte("inspection_date", monthStart).lte("inspection_date", today),

    // Dies needing correction
    supabase.from("dies").select("id", { count: "exact", head: true })
      .eq("company_id", context.companyId).eq("die_status", "correction"),
    // Inactive/dead dies
    supabase.from("dies").select("id", { count: "exact", head: true })
      .eq("company_id", context.companyId).in("die_status", ["inactive", "dead"]),

    // Unread alerts
    supabase.from("notifications").select("id, title, severity, notification_type, created_at", { count: "exact" })
      .eq("company_id", context.companyId).eq("is_read", false).order("created_at", { ascending: false }).limit(8),
    // Open tasks
    supabase.from("tasks").select("id, title, priority, status, due_date, assigned_to, task_type", { count: "exact" })
      .eq("company_id", context.companyId).in("status", ["open", "in_progress"]).order("due_date", { ascending: true }).limit(10),
    // Urgent tasks
    supabase.from("tasks").select("id", { count: "exact", head: true })
      .eq("company_id", context.companyId).eq("priority", "urgent").in("status", ["open", "in_progress"]),

    // Active customers
    supabase.from("orders").select("customer_id")
      .eq("company_id", context.companyId).gte("order_date", monthStart).lte("order_date", today).neq("current_stage", "cancelled"),
    // Recent orders
    supabase.from("orders").select("id, order_number, order_value, order_date, current_stage, priority, customers(customer_name, company_name)")
      .eq("company_id", context.companyId).order("order_date", { ascending: false }).limit(5),
    // Top customers by order value
    supabase.from("orders").select("customer_id, order_value, customers(customer_name, company_name)")
      .eq("company_id", context.companyId).gte("order_date", monthStart).lte("order_date", today).neq("current_stage", "cancelled"),

    // Completed production jobs for weight calculation
    supabase.from("production_jobs").select("id, actual_quantity_kg")
      .eq("company_id", context.companyId).eq("status", "completed").gte("updated_at", monthStartIso).lt("updated_at", tomorrowStartIso),
    // Scrap records weight calculation
    supabase.from("scrap_records").select("weight_kg")
      .eq("company_id", context.companyId).gte("created_at", monthStartIso).lt("created_at", tomorrowStartIso),
  ]);

  const completedProductionJobs = productionJobsCompleted.data ?? [];
  const completedProductionJobIds = completedProductionJobs.map((job: any) => job.id);
  const issuedBillets = completedProductionJobIds.length
    ? await supabase.from("foundry_billets")
      .select("production_job_id, weight_kg")
      .eq("company_id", context.companyId)
      .in("production_job_id", completedProductionJobIds)
      .in("status", ["issued", "consumed"])
    : { data: [], error: null };

  // Compute derived metrics
  const monthlyQuoteValue = (monthlyQuotes.data ?? []).reduce((s, q: any) => s + Number(q.grand_total ?? 0), 0);
  const monthlyOrderValue = (monthlyOrders.data ?? []).reduce((s, o: any) => s + Number(o.order_value ?? 0), 0);
  const lastMonthOrderValue = (lastMonthOrders.data ?? []).reduce((s, o: any) => s + Number(o.order_value ?? 0), 0);
  const sentQuoteValue = (sentQuotes.data ?? []).reduce((s, q: any) => s + Number(q.grand_total ?? 0), 0);
  const monthlyPaymentValue = (monthlyPayments.data ?? []).reduce((s: number, p: any) => s + Number(p.amount ?? 0), 0);
  const totalReceivableValue = (totalReceivables.data ?? []).reduce((s, i: any) => s + Number(i.balance_due ?? 0), 0);
  const dispatchWeight = (monthlyDispatches.data ?? []).reduce((s, d: any) => s + Number(d.total_weight_kg ?? 0), 0);
  const activeCustomerIds = new Set((activeCustomers.data ?? []).map((r: any) => r.customer_id).filter(Boolean));

  // Scrap & yield. Recovery uses only physical billet input linked to each
  // completed job; it is not inferred from output plus recorded scrap.
  const totalProduced = completedProductionJobs.reduce((s: number, j: any) => s + Number(j.actual_quantity_kg ?? 0), 0);
  const totalScrap = (scrapRecordsMonthly.data ?? []).reduce((s, j: any) => s + Number(j.weight_kg ?? 0), 0);
  const recovery = calculateIssuedBilletRecovery(completedProductionJobs, issuedBillets.data ?? []);

  // Low stock filtering
  const lowStockFiltered = (lowStockItems.data ?? []).filter((item: any) => {
    const reorderLevel = Number(item.reorder_level ?? 0);
    return reorderLevel > 0 && Number(item.current_stock ?? 0) <= reorderLevel;
  });

  // Quality metrics
  const totalInspected = (qualityFails.data ?? []).length;
  const failedInspections = (qualityFails.data ?? []).filter((q: any) => q.status === "rejected" || q.status === "rework").length;

  // Top customers aggregation
  const customerMap = new Map<string, { name: string; value: number }>();
  (topCustomers.data ?? []).forEach((o: any) => {
    const name = o.customers?.company_name || o.customers?.customer_name || "Unknown";
    const existing = customerMap.get(o.customer_id) || { name, value: 0 };
    existing.value += Number(o.order_value ?? 0);
    customerMap.set(o.customer_id, existing);
  });
  const topCustomersList = Array.from(customerMap.values()).sort((a, b) => b.value - a.value).slice(0, 5);

  // Revenue growth
  const revenueGrowth = lastMonthOrderValue > 0 ? ((monthlyOrderValue - lastMonthOrderValue) / lastMonthOrderValue) * 100 : 0;

  // Quote conversion
  const quoteConversionRate = (monthlyQuotes.count ?? 0) > 0 ? ((convertedQuotes.count ?? 0) / (monthlyQuotes.count ?? 0)) * 100 : 0;

  // Build insights
  const insights: { text: string; severity: "info" | "warning" | "critical" | "success" }[] = [];

  if (revenueGrowth > 10) insights.push({ text: `Revenue grew ${revenueGrowth.toFixed(0)}% compared to last month. Strong momentum.`, severity: "success" });
  else if (revenueGrowth < -10) insights.push({ text: `Revenue declined ${Math.abs(revenueGrowth).toFixed(0)}% compared to last month. Review pipeline.`, severity: "warning" });

  if (totalReceivableValue > monthlyOrderValue * 0.5) insights.push({ text: `Receivables (₹${(totalReceivableValue / 100000).toFixed(1)}L) exceed 50% of monthly revenue. Follow up urgently.`, severity: "critical" });

  if (recovery.percent !== null && recovery.percent < 85) insights.push({ text: `Recovery rate ${recovery.percent.toFixed(1)}% is below 85% target. Investigate billet quality and die condition.`, severity: "warning" });
  else if (recovery.percent !== null && recovery.percent >= 90) insights.push({ text: `Recovery rate ${recovery.percent.toFixed(1)}% — excellent yield performance this month.`, severity: "success" });
  else if (recovery.missingJobCount > 0) insights.push({ text: `Recovery is not captured: ${recovery.missingJobCount} completed production job(s) have no issued billet input.`, severity: "warning" });

  if (lowStockFiltered.length > 3) insights.push({ text: `${lowStockFiltered.length} inventory items below reorder level. Check billet and packing material stock.`, severity: "warning" });

  if ((delayedOrders.data ?? []).length > 0) insights.push({ text: `${(delayedOrders.data ?? []).length} orders past expected dispatch date. Production or finishing delay likely.`, severity: "critical" });

  if (quoteConversionRate > 0 && quoteConversionRate < 20) insights.push({ text: `Quote conversion rate is ${quoteConversionRate.toFixed(0)}% this month. Below 20% indicates pricing or follow-up issues.`, severity: "warning" });
  else if (quoteConversionRate >= 40) insights.push({ text: `Quote conversion rate ${quoteConversionRate.toFixed(0)}% — strong closing performance.`, severity: "success" });

  if ((dieCorrectionCount.count ?? 0) > 2) insights.push({ text: `${dieCorrectionCount.count} dies in correction queue. This may bottleneck production scheduling.`, severity: "warning" });

  if ((qualityHolds.count ?? 0) > 0) insights.push({ text: `${qualityHolds.count} quality holds pending. Resolve before dispatch to prevent customer complaints.`, severity: "critical" });

  if (topCustomersList.length > 0) {
    insights.push({ text: `Top customer this month: ${topCustomersList[0].name} with ₹${(topCustomersList[0].value / 100000).toFixed(1)}L in orders.`, severity: "info" });
  }

  const queryErrors = [
    monthlyQuotes, monthlyOrders, lastMonthOrders, pendingQuotes, sentQuotes, convertedQuotes,
    activeProduction, plannedJobs,
    pendingDispatch, monthlyDispatches, delayedOrders,
    overdueInvoices, monthlyPayments, totalReceivables,
    lowStockItems, totalInventoryItems,
    qualityHolds, qualityFails,
    dieCorrectionCount, dieInactiveCount,
    unreadAlerts, openTasks, urgentTasks,
    activeCustomers, recentOrders, topCustomers, productionJobsCompleted, scrapRecordsMonthly, issuedBillets,
  ].map((r) => (r.error ? getErrorMessage(r.error) : "")).filter(Boolean);

  return (
    <div>
      <PageHeader
        title="Command Center"
        description="Owner-level intelligence dashboard — revenue, production, dispatch, receivables, quality, inventory, and AI-powered business insights."
        actions={
          <Link href="/dashboard" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-700 shadow-sm transition hover:border-orange hover:text-orange">
            Standard Dashboard
          </Link>
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
          quoteConversionRate,
          activeProductionCount: activeProduction.count ?? 0,
          plannedJobCount: plannedJobs.count ?? 0,
          monthlyDispatchCount: monthlyDispatches.count ?? 0,
          dispatchWeight,
          delayedOrderCount: (delayedOrders.data ?? []).length,
          pendingDispatchCount: pendingDispatch.count ?? 0,
          totalReceivableValue,
          overdueInvoiceCount: (overdueInvoices.data ?? []).length,
          monthlyPaymentValue,
          lowStockCount: lowStockFiltered.length,
          totalInventoryCount: totalInventoryItems.count ?? 0,
          totalProduced,
          totalScrap,
          recoveryPercent: recovery.percent,
          recoveryInputKg: recovery.issuedInputKg,
          recoveryOutputKg: recovery.capturedOutputKg,
          recoveryCapturedJobCount: recovery.capturedJobCount,
          recoveryMissingJobCount: recovery.missingJobCount,
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
