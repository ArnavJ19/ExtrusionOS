import Link from "next/link";
import { OperationalWorkLinks } from "@/components/modules/shared/operational-work-links";
import { ModuleOverviewClient } from "@/components/modules/operations/module-overview-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { canReadProjects } from "@/lib/workflow/customer-projects";
import { redirect } from "next/navigation";

export default async function CustomersPage() {
  const context = await getSessionContext();
  if (!can(context.role, "read", "customers")) redirect("/dashboard");
  return (
    <div className="space-y-2">
      <OperationalWorkLinks area="customers" role={context.role} dealer={!!context.dealerId}/>
      <ModuleOverviewClient moduleKey="customers" context={context} canCreate={can(context.role, "create", "customers")} />
      {!context.dealerId && canReadProjects(context.role) ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div><p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Project Grouping</p><h2 className="section-title mt-1">Projects and Delivery Sites</h2><p className="mt-1 text-sm font-medium text-slate-500">See each site&apos;s linked quotations, orders and dispatches with ordered and dispatched quantities in one place.</p></div>
            <Link href="/customers/projects" className="inline-flex items-center justify-center rounded-xl bg-charcoal px-4 py-2.5 text-sm font-bold text-white transition hover:bg-charcoal/90">Open Projects</Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
