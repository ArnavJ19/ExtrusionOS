import { ModuleOverviewClient } from "@/components/modules/operations/module-overview-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { METAL_FINANCE_ROLES } from "@/lib/foundry/scrap-receiving";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function ExpensesPage() {
  const context = await getSessionContext();
  if (!can(context.role, "read", "financials")) redirect("/dashboard");
  const metalBills = (METAL_FINANCE_ROLES as readonly string[]).includes(context.role);
  return <ModuleOverviewClient moduleKey="expenses" context={context} canCreate={can(context.role, "create", "financials")} canUpdate={can(context.role, "update", "financials")}>
    {metalBills ? <div className="flex flex-col gap-2 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Foundry purchases</p>
        <h2 className="section-title mt-1">Metal bills</h2>
        <p className="mt-1 text-sm font-medium text-slate-500">Scrap and external aluminium received by the foundry, waiting for the vendor, bill, rate and tax.</p>
      </div>
      <Link href="/foundry/metal-finance" className="inline-flex rounded-xl bg-charcoal px-4 py-2.5 text-sm font-bold text-white">Open metal bills</Link>
    </div> : null}
  </ModuleOverviewClient>;
}
