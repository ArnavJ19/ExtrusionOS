import { ModuleOverviewClient } from "@/components/modules/operations/module-overview-client";
import Link from "next/link";
import { canReadRates } from "@/lib/workflow/costing-rates";
import { QuotesDashboard } from "@/components/modules/dashboards/quotes-dashboard";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { QueryErrorNotice } from "@/components/ui/query-error-notice";
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
    supabase.from("quotes_authorized").select("id, status, grand_total", { count: "exact" }).eq("company_id", cid),
    supabase.from("quotes_authorized").select("id, customer_id, quote_number, grand_total, quote_date, valid_until, status").eq("company_id", cid).order("quote_date", { ascending: false }).limit(5),
    supabase.from("quotes_authorized").select("id, grand_total", { count: "exact" }).eq("company_id", cid).gte("quote_date", monthStart),
    supabase.from("quotes_authorized").select("id", { count: "exact", head: true }).eq("company_id", cid).in("status", ["approved_for_sending", "sent", "customer_approved"]).lte("valid_until", sevenDays).gte("valid_until", today),
    supabase.from("quotes_authorized").select("id", { count: "exact", head: true }).eq("company_id", cid).in("status", ["internal_review", "approved_for_sending"]),
    supabase.from("orders_authorized").select("order_value, order_date").eq("company_id", cid).not("quote_id", "is", null).neq("current_stage", "cancelled"),
  ]);

  const recentCustomerIds = [...new Set((recentQuotes.data ?? []).map((quote: any) => quote.customer_id).filter(Boolean))];
  const customersResult = recentCustomerIds.length
    ? await supabase.from("customers").select("id, customer_name, company_name").eq("company_id", cid).in("id", recentCustomerIds)
    : { data: [], error: null };
  const customerById = new Map((customersResult.data ?? []).map((customer: any) => [customer.id, customer]));
  const recentQuoteRows = (recentQuotes.data ?? []).map((quote: any) => ({
    ...quote,
    customers: customerById.get(quote.customer_id) ?? null
  }));
  const queryErrors = [allQuotes.error, recentQuotes.error, monthlyQuotes.error, expiringQuotes.error, pendingApproval.error, salesQuery.error, customersResult.error].filter(Boolean).map((error) => error?.message ?? "Quote data could not be loaded.");

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
      <ModuleOverviewClient moduleKey="quotes" context={context} canCreate={can(context.role, "create", "quotes")} canUpdate={can(context.role, "update", "quotes")} hideHeaderActions={true} hideMetricsAndCharts={true}>
        <QueryErrorNotice messages={queryErrors} />
        {!context.dealerId && canReadRates(context.role) ? (
          <div className="flex justify-end"><Link href="/quotes/rates" className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold">Costing rates</Link></div>
        ) : null}
        <QuotesDashboard
          canCreate={can(context.role, "create", "quotes")}
          showQuoteValues={["owner", "admin", "sales_manager", "sales", "accounts", "dealer_admin", "dealer_staff"].includes(context.role)}
          totalPipelineValue={totalPipelineValue}
          activeQuoteCount={activeQuotes.length}
          convertedCount={convertedQuotes.length}
          totalQuoteCount={rows.length}
          expiringCount={expiringQuotes.count ?? 0}
          pendingApprovalCount={pendingApproval.count ?? 0}
          statusBreakdown={statusBreakdown}
          recentQuotes={recentQuoteRows as any}
          monthlyCount={monthlyQuotes.count ?? 0}
          salesHistory={salesHistory}
          allQuotes={allQuotesData}
        />
      </ModuleOverviewClient>
    </div>
  );
}
