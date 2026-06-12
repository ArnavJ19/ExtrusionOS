import { PageHeader } from "@/components/layout/page-header";
import { QueryErrorNotice } from "@/components/ui/query-error-notice";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { getErrorMessage } from "@/lib/utils/errors";
import { DashboardTabs } from "@/components/modules/dashboard-client";
import { redirect } from "next/navigation";

const activeProductionStages = ["order_confirmed", "die_ready", "billet_ready", "billet_heating", "extrusion_planned", "extruded", "stretching", "cutting", "aging", "surface_treatment", "finishing", "packing", "payment_pending"];

export default async function DashboardPage() {
  const context = await getSessionContext();
  if (context.role === "dealer_admin" || context.role === "dealer_staff") {
    redirect("/portal/dashboard");
  }
  const supabase = await createClient();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  const [activeCustomers, recentQuotes, monthlyQuotes, recentOrders, monthlyOrders, productionOrders, pendingDispatchOrders, dispatches, dies, delayed, inventoryItems, qcHolds, todayJobs, pendingQuotes] = await Promise.all([
    supabase.from("orders").select("customer_id").eq("company_id", context.companyId).gte("order_date", monthStart).neq("current_stage", "cancelled"),
    supabase.from("quotes").select("id, quote_number, grand_total, quote_date, status, customers(customer_name, company_name)").eq("company_id", context.companyId).order("quote_date", { ascending: false }).limit(5),
    supabase.from("quotes").select("id, grand_total", { count: "exact" }).eq("company_id", context.companyId).gte("quote_date", monthStart),
    supabase.from("orders").select("id, order_number, order_value, order_date, expected_dispatch_date, current_stage, priority, customers(customer_name, company_name)").eq("company_id", context.companyId).order("order_date", { ascending: false }).limit(8),
    supabase.from("orders").select("id, order_value", { count: "exact" }).eq("company_id", context.companyId).gte("order_date", monthStart).neq("current_stage", "cancelled"),
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("company_id", context.companyId).in("current_stage", activeProductionStages),
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("company_id", context.companyId).not("current_stage", "in", "(dispatched,delivered,closed,cancelled)"),
    supabase.from("dispatches").select("id", { count: "exact", head: true }).eq("company_id", context.companyId).gte("dispatch_date", monthStart),
    supabase.from("dies").select("id", { count: "exact", head: true }).eq("company_id", context.companyId).eq("die_status", "correction"),
    supabase.from("orders").select("id, order_number, expected_dispatch_date").eq("company_id", context.companyId).lt("expected_dispatch_date", today).not("current_stage", "in", "(dispatched,delivered,closed,cancelled)").order("expected_dispatch_date", { ascending: true }).limit(5),
    supabase.from("inventory_items").select("id, item_code, item_name, item_category, current_stock, reorder_level, unit").eq("company_id", context.companyId).eq("is_active", true).order("current_stock", { ascending: true }).limit(50),
    supabase.from("quality_inspections").select("id", { count: "exact", head: true }).eq("company_id", context.companyId).in("status", ["rejected", "rework"]),
    supabase.from("production_jobs").select("id", { count: "exact", head: true }).eq("company_id", context.companyId).eq("planned_date", today).not("status", "in", "(completed,cancelled)"),
    supabase.from("quotes").select("id", { count: "exact", head: true }).eq("company_id", context.companyId).in("status", ["draft", "internal_review", "approved_for_sending", "sent"])
  ]);

  const quoteRows = recentQuotes.data ?? [];
  const orderRows = recentOrders.data ?? [];
  const monthlyQuoteValue = (monthlyQuotes.data ?? []).reduce((sum, quote: any) => sum + Number(quote.grand_total ?? 0), 0);
  const monthlyOrderValue = (monthlyOrders.data ?? []).reduce((sum: number, order: any) => sum + Number(order.order_value ?? 0), 0);
  const productionCount = productionOrders.count ?? 0;
  const pendingDispatchCount = pendingDispatchOrders.count ?? 0;
  const delayedOrders = delayed.data ?? [];
  const activeCustomerCount = new Set((activeCustomers.data ?? []).map((row: any) => row.customer_id).filter(Boolean)).size;
  const lowInventoryRows = (inventoryItems.data ?? []).filter((item: any) => Number(item.current_stock ?? 0) <= Number(item.reorder_level ?? 0)).slice(0, 5);
  const queryErrors = [activeCustomers, recentQuotes, monthlyQuotes, recentOrders, monthlyOrders, productionOrders, pendingDispatchOrders, dispatches, dies, delayed, inventoryItems, qcHolds, todayJobs, pendingQuotes]
    .map((result) => result.error ? getErrorMessage(result.error) : "")
    .filter(Boolean);

  return (
    <div>
      <PageHeader title="Dashboard" description="Owner-level snapshot of quotation value, order movement, die health, pending production, and dispatch readiness." />
      <QueryErrorNotice messages={queryErrors} />
      
      <DashboardTabs 
        quoteRows={quoteRows}
        orderRows={orderRows}
        monthlyQuoteValue={monthlyQuoteValue}
        monthlyOrderValue={monthlyOrderValue}
        productionCount={productionCount}
        pendingDispatchCount={pendingDispatchCount}
        delayedOrders={delayedOrders}
        activeCustomerCount={activeCustomerCount}
        monthlyQuoteCount={monthlyQuotes.count ?? 0}
        monthlyOrderCount={monthlyOrders.count ?? 0}
        dispatchCount={dispatches.count ?? 0}
        dieCorrectionCount={dies.count ?? 0}
        lowInventoryRows={lowInventoryRows}
        qualityHoldCount={qcHolds.count ?? 0}
        todayJobCount={todayJobs.count ?? 0}
        pendingQuoteCount={pendingQuotes.count ?? 0}
      />
    </div>
  );
}
