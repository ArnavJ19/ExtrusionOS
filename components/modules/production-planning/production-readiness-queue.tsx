import Link from "next/link";
import { CalendarDays, Factory, Gauge, PackageCheck } from "lucide-react";
import { ReadinessBadge } from "@/components/modules/production-planning/readiness-badge";
import { formatDate, formatWeight } from "@/lib/utils/format";

type ReadinessOrder = {
  id: string;
  order_number: string;
  priority: string | null;
  current_stage: string | null;
  expected_dispatch_date: string | null;
  billets_required: number | null;
  billets_allocated: number | null;
  billets_short: number | null;
  billet_allocation_status: string | null;
  production_profile?: { profile_code?: string | null; profile_name?: string | null } | null;
  production_die?: { die_number?: string | null; die_status?: string | null } | null;
  customers?: { company_name?: string | null; customer_name?: string | null } | null;
};

type ScheduleJob = {
  id: string;
  job_number: string;
  status: string | null;
  planned_date: string | null;
  planned_quantity_kg: number | null;
  machine?: { machine_name?: string | null } | null;
  order?: { order_number?: string | null } | null;
};

function dieReady(order: ReadinessOrder) {
  return Boolean(order.production_die?.die_number && !["blocked", "inactive", "dead", "retired", "scrapped", "under_maintenance"].includes(String(order.production_die?.die_status ?? "")));
}

export function ProductionReadinessQueue({ orders, todayJobs }: { orders: ReadinessOrder[]; todayJobs: ScheduleJob[] }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Order to Press</p>
          <h2 className="section-title mt-1">Press Planning Today</h2>
          <p className="mt-1 text-sm font-medium text-slate-500">Orders and jobs that need die, billet, or press attention before extrusion.</p>
        </div>
        <Link href="/production/schedule" className="inline-flex items-center justify-center gap-2 rounded-xl bg-charcoal px-4 py-2.5 text-sm font-bold text-white transition hover:bg-charcoal/90">
          <CalendarDays className="h-4 w-4" /> Open Schedule
        </Link>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-black text-slate-800"><PackageCheck className="h-4 w-4 text-orange" /> Readiness Queue</div>
          {orders.length ? orders.map((order) => (
            <Link key={order.id} href={`/orders/${order.id}`} className="block rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:border-orange/40 hover:bg-white">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-black text-slate-950">{order.order_number}</p>
                  <p className="mt-1 text-xs font-semibold text-slate-500">{order.customers?.company_name || order.customers?.customer_name || "Customer"} · {order.production_profile?.profile_code || "Profile pending"}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <ReadinessBadge status={order.billet_allocation_status} />
                  <ReadinessBadge status={dieReady(order) ? "ready" : "blocked"} />
                </div>
              </div>
              <div className="mt-3 grid gap-2 text-xs font-semibold text-slate-600 sm:grid-cols-4">
                <span>Dispatch: <b className="text-slate-950">{order.expected_dispatch_date ? formatDate(order.expected_dispatch_date) : "Not set"}</b></span>
                <span>Die: <b className="text-slate-950">{order.production_die?.die_number || "Missing"}</b></span>
                <span>Billets: <b className="text-slate-950">{order.billets_allocated ?? 0}/{order.billets_required ?? 0}</b></span>
                <span>Short: <b className={Number(order.billets_short ?? 0) > 0 ? "text-amber-700" : "text-emerald-700"}>{order.billets_short ?? 0}</b></span>
              </div>
            </Link>
          )) : (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-600">No open production orders need immediate press-readiness attention.</div>
          )}
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-black text-slate-800"><Factory className="h-4 w-4 text-orange" /> Scheduled Today</div>
          {todayJobs.length ? todayJobs.map((job) => (
            <Link key={job.id} href={`/production/${job.id}`} className="block rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-orange/40">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-black text-slate-950">{job.job_number}</p>
                  <p className="mt-1 text-xs font-semibold text-slate-500">{job.order?.order_number || "Order"} · {job.machine?.machine_name || "No press assigned"}</p>
                </div>
                <ReadinessBadge status={job.status} />
              </div>
              <div className="mt-3 flex items-center justify-between text-xs font-semibold text-slate-600">
                <span className="inline-flex items-center gap-1"><Gauge className="h-3.5 w-3.5" /> Planned</span>
                <b className="text-slate-950">{formatWeight(job.planned_quantity_kg ?? 0)}</b>
              </div>
            </Link>
          )) : (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-600">No extrusion jobs are scheduled for today.</div>
          )}
        </div>
      </div>
    </section>
  );
}
