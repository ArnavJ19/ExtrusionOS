import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { InsightsNav } from "@/components/modules/autopilot-batch8/insights-nav";
import { getSessionContext } from "@/lib/auth";
import { getFeatureFlagsForCompany, isFeatureEnabled } from "@/lib/enterprise/features";
import { insightsFor } from "@/lib/insights/destinations";
import { planDestinationsFor } from "@/lib/intelligence/destinations";
import { metricsForRole, type MetricArea } from "@/lib/insights/metrics";
import { createClient } from "@/lib/supabase/server";

const AREA: Record<MetricArea, string> = { production: "Production", sales: "Sales", dispatch: "Dispatch", quality: "Quality", finance: "Finance" };

// AP-044: one entry point for reporting. Every KPI is defined once in lib/insights/metrics and listed here with its
// definition; financial KPIs are listed only for roles that may read money.
export default async function InsightsPage() {
  const context = await getSessionContext();
  if (context.dealerId || !["owner", "admin", "sales_manager", "accounts"].includes(context.role)) redirect("/dashboard");
  const flags = await getFeatureFlagsForCompany(await createClient(), context.companyId).catch(() => ({}));
  const destinations = insightsFor(context.role, module => isFeatureEnabled(flags, module));
  const metrics = metricsForRole(context.role);
  const areas = [...new Set(metrics.map(m => m.area))];
  const plans = planDestinationsFor(context.role);
  return <div className="space-y-5">
    <InsightsNav current="/insights" />
    <PageHeader title="Insights" description="Reports, trends and the definition of every number they show." />
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{destinations.map(d => <Link key={d.href} href={d.href} className="min-w-0 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm transition hover:border-orange/60">
      <p className="font-black">{d.label}</p><p className="mt-1 text-sm text-neutral-600">{d.description}</p></Link>)}</div>
    {plans.length ? <section aria-labelledby="plan-predict" className="space-y-3">
      <h2 id="plan-predict" className="text-lg font-bold">Plan and predict</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{plans.map(d => <Link key={d.href} href={d.href} className="min-w-0 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm transition hover:border-orange/60">
        <p className="font-black">{d.label}</p><p className="mt-1 text-sm text-neutral-600">{d.description}</p></Link>)}</div>
    </section> : null}
    <section aria-labelledby="kpi-catalogue" className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-4">
      <div><h2 id="kpi-catalogue" className="text-lg font-bold">What each number means</h2><p className="text-sm text-neutral-600">One definition per KPI, used by every screen that shows it. Where a definition changes, it changes here and on every screen together. <Link href="/insights/kpis" className="font-bold underline">See this month&apos;s values</Link>.</p></div>
      {areas.map(area => <div key={area} className="space-y-2"><h3 className="text-sm font-black uppercase tracking-wide text-neutral-500">{AREA[area]}</h3>
        <dl className="grid gap-2 lg:grid-cols-2">{metrics.filter(m => m.area === area).map(m => <div key={m.key} className="min-w-0 rounded-xl bg-neutral-50 p-3">
          <dt className="font-bold">{m.label}</dt><dd className="mt-1 text-sm">{m.definition}</dd>
          <dd className="mt-1 text-xs text-neutral-600">Excludes: {m.excludes} · Shown on {m.shownOn.join(", ")}</dd></div>)}</dl></div>)}
    </section>
  </div>;
}
