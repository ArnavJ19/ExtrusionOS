import { ModuleOverviewClient } from "@/components/modules/operations/module-overview-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function PackagingPage() {
  const context = await getSessionContext();
  if (!can(context.role, "read", "packaging")) redirect("/dashboard");
  return (
    <ModuleOverviewClient moduleKey="packaging" context={context} canCreate={can(context.role, "create", "packaging")} canUpdate={can(context.role, "update", "packaging")}>
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Packaging Stock</p><h2 className="section-title mt-1">Packaging Material Inventory</h2><p className="mt-1 text-sm font-medium text-slate-500">Maintain film, paper, strapping, crates, reorder levels, and vendor traceability.</p></div>
          <Link href="/packaging/materials" className="inline-flex items-center justify-center rounded-xl bg-charcoal px-4 py-2.5 text-sm font-bold text-white transition hover:bg-charcoal/90">Open Material Inventory</Link>
        </div>
      </div>
    </ModuleOverviewClient>
  );
}
