import { ModuleOverviewClient } from "@/components/modules/operations/module-overview-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function FoundryPage() {
  const context = await getSessionContext();
  if (!can(context.role, "read", "foundry")) redirect("/dashboard");
  const supabase = await createClient();
  const { data: billetNeeds } = await supabase
    .from("order_billet_requirements")
    .select("id, order_id, alloy, billet_diameter_inch, billets_required, billets_allocated, billets_short, status, orders(order_number, priority, expected_dispatch_date)")
    .eq("company_id", context.companyId)
    .in("status", ["pending", "partial", "shortage"])
    .gt("billets_short", 0)
    .order("billets_short", { ascending: false })
    .limit(8);
  return (
    <ModuleOverviewClient moduleKey="foundry" context={context} canCreate={can(context.role, "create", "foundry")} canUpdate={can(context.role, "update", "foundry")}>
      <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-700">Billet Allocation Queue</p>
            <h2 className="section-title mt-1">Orders Needing Billets</h2>
            <p className="mt-1 text-sm font-semibold text-amber-900">Allocate compatible in-house or outsourced billets by priority, alloy, and required diameter.</p>
          </div>
          <Link href="/orders/database" className="inline-flex rounded-xl bg-charcoal px-4 py-2.5 text-sm font-bold text-white">View Orders</Link>
        </div>
        {billetNeeds?.length ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {billetNeeds.map((need: any) => (
              <Link key={need.id} href={`/orders/${need.order_id}`} className="rounded-2xl border border-amber-200 bg-white p-4 shadow-sm transition hover:border-orange">
                <div className="flex items-center justify-between gap-2"><p className="font-black text-slate-950">{need.orders?.order_number ?? "Order"}</p><Badge value={need.orders?.priority ?? "normal"} /></div>
                <p className="mt-2 text-xs font-semibold text-slate-500">{need.alloy} · {need.billet_diameter_inch} in</p>
                <p className="mt-3 text-sm font-black text-amber-800">Needs {need.billets_short} more / {need.billets_required}</p>
                <p className="mt-1 text-xs font-semibold text-slate-500">Allocated {need.billets_allocated}</p>
              </Link>
            ))}
          </div>
        ) : <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800">No open billet shortages right now.</div>}
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-orange">External Inputs</p>
          <h2 className="section-title mt-1">External Aluminium Sources</h2>
          <p className="mt-1 text-sm font-medium text-slate-500">Trace ingot, bar, billet, wire, and chips by ID, vendor, origin, weight, and quantity.</p>
          <Link href="/foundry/external-sources" className="mt-4 inline-flex rounded-xl bg-charcoal px-4 py-2.5 text-sm font-bold text-white">Open Sources</Link>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Scrap Control</p>
          <h2 className="section-title mt-1">Aluminium Scrap</h2>
          <p className="mt-1 text-sm font-medium text-slate-500">Track incoming and in-house scrap by supplier, quality, weight, and usage status.</p>
          <Link href="/foundry/scrap" className="mt-4 inline-flex rounded-xl bg-charcoal px-4 py-2.5 text-sm font-bold text-white">Open Scrap</Link>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Cast Output</p>
          <h2 className="section-title mt-1">Aluminium Billets</h2>
          <p className="mt-1 text-sm font-medium text-slate-500">Track all cast billets, their dimensions, and current allocation status.</p>
          <Link href="/foundry/billets" className="mt-4 inline-flex rounded-xl bg-charcoal px-4 py-2.5 text-sm font-bold text-white">Open Billets</Link>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Purchased Input</p>
          <h2 className="section-title mt-1">Outsourced Billets</h2>
          <p className="mt-1 text-sm font-medium text-slate-500">Track batches of billets bought from outside vendors.</p>
          <Link href="/foundry/outsourced-billets/database" className="mt-4 inline-flex rounded-xl bg-charcoal px-4 py-2.5 text-sm font-bold text-white">Open Outsourced Billets</Link>
        </div>
      </div>
    </ModuleOverviewClient>
  );
}
