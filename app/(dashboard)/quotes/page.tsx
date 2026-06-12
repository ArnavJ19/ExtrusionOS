import { ModuleOverviewClient } from "@/components/modules/operations/module-overview-client";
import { QuotesDashboard } from "@/components/modules/dashboards/quotes-dashboard";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function QuotesPage() {
  const context = await getSessionContext();
  if (!can(context.role, "read", "quotes")) redirect("/dashboard");

  const supabase = await createClient();
  const cid = context.companyId;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const sevenDays = new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);

  const [allQuotes, recentQuotes, monthlyQuotes, expiringQuotes, pendingApproval, salesQuery] = await Promise.all([
    supabase.from("quotes").select("id, status, grand_total", { count: "exact" }).eq("company_id", cid),
    supabase.from("quotes").select("id, quote_number, grand_total, quote_date, valid_until, status, customers(customer_name, company_name)").eq("company_id", cid).order("quote_date", { ascending: false }).limit(5),
    supabase.from("quotes").select("id, grand_total", { count: "exact" }).eq("company_id", cid).gte("quote_date", monthStart),
    supabase.from("quotes").select("id", { count: "exact", head: true }).eq("company_id", cid).in("status", ["approved_for_sending", "sent", "customer_approved"]).lte("valid_until", sevenDays).gte("valid_until", today),
    supabase.from("quotes").select("id", { count: "exact", head: true }).eq("company_id", cid).in("status", ["internal_review", "approved_for_sending"]),
    supabase.from("orders").select("order_value, order_date").eq("company_id", cid).not("quote_id", "is", null).neq("current_stage", "cancelled"),
  ]);

  const rows = allQuotes.data ?? [];
  const activeStatuses = ["draft", "internal_review", "approved_for_sending", "sent", "customer_approved"];
  const activeQuotes = rows.filter((r: any) => activeStatuses.includes(r.status));
  const convertedQuotes = rows.filter((r: any) => r.status === "converted_to_order");
  const totalPipelineValue = activeQuotes.reduce((sum: number, r: any) => sum + Number(r.grand_total ?? 0), 0);

  // Build status breakdown
  const statusMap: Record<string, number> = {};
  for (const r of rows) { const s = (r as any).status ?? "draft"; statusMap[s] = (statusMap[s] ?? 0) + 1; }
  const statusBreakdown = Object.entries(statusMap).map(([status, count]) => ({ status, count }));

  const salesHistory = (salesQuery.data ?? []).map((o: any) => ({
    date: o.order_date,
    value: Number(o.order_value ?? 0)
  }));

  const allQuotesData = rows.map((q: any) => ({
    status: q.status,
    grand_total: Number(q.grand_total ?? 0)
  }));

  return (
    <div className="space-y-2">
      <ModuleOverviewClient moduleKey="quotes" context={context} canCreate={can(context.role, "create", "quotes")} canUpdate={can(context.role, "update", "quotes")} hideMetricsAndCharts={true}>
        <QuotesDashboard
          canCreate={can(context.role, "create", "quotes")}
          totalPipelineValue={totalPipelineValue}
          activeQuoteCount={activeQuotes.length}
          convertedCount={convertedQuotes.length}
          totalQuoteCount={rows.length}
          expiringCount={expiringQuotes.count ?? 0}
          pendingApprovalCount={pendingApproval.count ?? 0}
          statusBreakdown={statusBreakdown}
          recentQuotes={(recentQuotes.data ?? []) as any}
          monthlyCount={monthlyQuotes.count ?? 0}
          salesHistory={salesHistory}
          allQuotes={allQuotesData}
        />
      </ModuleOverviewClient>
    </div>
  );
}
