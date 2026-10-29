import Link from "next/link";
import { ArrowRight, Truck } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatWeight } from "@/lib/utils/format";
import { canAccessMobileDestination } from "@/lib/auth/role-experience";
import { redirect } from "next/navigation";
import { MobilePagination } from "@/components/ui/mobile-pagination";
import { canRecordMobileBundle } from "@/lib/workflow/mobile-bundle-task";

export default async function MobileDispatchPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const context = await getSessionContext();
  if (!canAccessMobileDestination(context.role, "dispatch")) redirect("/dashboard?denied=1");
  const supabase = await createClient();
  const page = Math.max(1, Number((await searchParams).page ?? 1) || 1);
  const pageSize = 20;
  const { data: dispatches, error, count } = await supabase
    .from("dispatches")
    .select("id, dispatch_number, vehicle_number, transporter_name, number_of_bundles, total_weight_kg, delivery_status, orders(order_number, customers(customer_name, company_name))", { count: "exact" })
    .eq("company_id", context.companyId)
    .not("delivery_status", "in", "(delivered,cancelled)")
    .order("dispatch_date", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  return (
    <div className="mx-auto max-w-xl space-y-4">
      {canRecordMobileBundle(context.role,context.dealerId)?<Link href="/mobile/dispatch/bundles" className="block rounded-2xl bg-orange p-4 text-center font-bold text-white">Measure and tag a physical bundle</Link>:null}
      <div className="rounded-3xl bg-slate-950 p-6 text-white"><Truck className="h-8 w-8 text-orange" /><h1 className="mt-3 text-2xl font-black">Dispatch Loading</h1><p className="mt-1 text-sm font-medium text-slate-300">Open active dispatch records for loading, transporter, vehicle, and delivery updates.</p></div>
      {error ? <ErrorState description="Dispatch records could not be loaded. Refresh and try again before assuming the queue is empty." /> : dispatches?.length ? dispatches.map((load: any) => (
        <Link href={`/dispatches/${load.id}`} key={load.id} className="block rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition active:scale-[0.99]">
          <div className="flex items-start justify-between gap-3"><div><p className="text-xl font-black text-slate-950">{load.dispatch_number}</p><p className="mt-1 text-sm font-medium text-slate-500">{load.orders?.customers?.company_name || load.orders?.customers?.customer_name || load.orders?.order_number || "Customer"} - {load.vehicle_number || load.transporter_name || "Vehicle not captured"}</p></div><span className={`rounded-full px-3 py-1 text-xs font-black capitalize ${statusClass(load.delivery_status)}`}>{String(load.delivery_status).replace(/_/g, " ")}</span></div>
          <div className="mt-4 grid grid-cols-2 gap-3"><Metric label="Bundles" value={String(load.number_of_bundles ?? 0)} /><Metric label="Weight" value={formatWeight(load.total_weight_kg)} /></div>
          <p className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white">Open dispatch workflow <ArrowRight className="h-4 w-4" /></p>
        </Link>
      )) : <EmptyState title="No active dispatches" description="Dispatch loading records appear here after dispatches are created and not yet delivered." />}
      <MobilePagination path="/mobile/dispatch" page={page} pageSize={pageSize} totalCount={count ?? 0} />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl bg-aluminium p-4"><p className="text-xs font-black text-slate-500">{label}</p><p className="mt-1 text-2xl font-black text-slate-950">{value}</p></div>;
}

function statusClass(status: string) {
  if (["delivered", "ready"].includes(status)) return "bg-emerald-100 text-emerald-800";
  if (["loading", "in_transit", "delayed"].includes(status)) return "bg-orange/10 text-orange";
  return "bg-blue-100 text-blue-800";
}
