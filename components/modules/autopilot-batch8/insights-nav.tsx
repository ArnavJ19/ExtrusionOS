// AP-044: one Insights module. The tab strip shown above every reporting screen, filtered by role and feature flag.
import Link from "next/link";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getFeatureFlagsForCompany, isFeatureEnabled } from "@/lib/enterprise/features";
import { insightsFor } from "@/lib/insights/destinations";

export async function InsightsNav({ current }: { current: string }) {
  const context = await getSessionContext();
  if (context.dealerId) return null;
  const flags = await getFeatureFlagsForCompany(await createClient(), context.companyId).catch(() => ({}));
  const tabs = insightsFor(context.role, module => isFeatureEnabled(flags, module));
  return <nav aria-label="Insights" className="mb-4 flex min-w-0 flex-wrap gap-1 rounded-2xl border border-neutral-200 bg-white p-1 text-sm">
    <Link href="/insights" className={`rounded-xl px-3 py-2 font-semibold ${current === "/insights" ? "bg-neutral-950 text-white" : "hover:bg-neutral-100"}`} aria-current={current === "/insights" ? "page" : undefined}>Insights</Link>
    {tabs.map(tab => <Link key={tab.href} href={tab.href} aria-current={current === tab.href ? "page" : undefined} className={`rounded-xl px-3 py-2 font-semibold ${current === tab.href ? "bg-neutral-950 text-white" : "hover:bg-neutral-100"}`}>{tab.label}</Link>)}
  </nav>;
}
