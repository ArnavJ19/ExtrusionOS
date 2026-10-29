import { ModuleOverviewClient } from "@/components/modules/operations/module-overview-client";
import { ProductionDashboard } from "@/components/modules/dashboards/production-dashboard";
import { ProductionReadinessQueue } from "@/components/modules/production-planning/production-readiness-queue";
import { ModuleDisabled } from "@/components/ui/module-disabled";
import Link from "next/link";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { getFeatureFlagsForCompany, isFeatureEnabled } from "@/lib/enterprise/features";
import { createClient } from "@/lib/supabase/server";
import { getBusinessDateBoundaries } from "@/lib/utils/business-date";
import { redirect } from "next/navigation";
import { LineDeliveryQueue } from "@/components/modules/orders/order-line-schedule";
import { loadLineDeliveryQueue } from "@/lib/workflow/order-line-schedule-loader";
import { canReadLineSchedule } from "@/lib/workflow/order-line-schedule";
import { canBulkJobs } from "@/lib/workflow/bulk-queue";

export default async function ProductionPage() {
  const context = await getSessionContext();
  const supabase = await createClient();
  const flags = await getFeatureFlagsForCompany(supabase, context.companyId);
  if (!isFeatureEnabled(flags, "production_planning")) return <ModuleDisabled moduleName="production_planning" title="Production Planning" />;
  if (!can(context.role, "read", "production")) redirect("/dashboard");

  const cid = context.companyId;
  const { monthStartIso, today, tomorrowStartIso } = getBusinessDateBoundaries();

  const [allJobs, recentJobs, monthlyCompleted, finishing, overdueJobs, noMachine, readinessOrders, todayScheduleJobs] = await Promise.all([
    supabase.from("production_jobs").select("id, status, planned_quantity_kg, actual_quantity_kg, planned_date, completed_at, machine_id, machine:machines(machine_name)", { count: "exact" }).eq("company_id", cid),
    supabase.from("production_jobs").select("id, job_number, status, planned_date, planned_quantity_kg, actual_quantity_kg, machine:machines(machine_name), order:orders(order_number, customers(customer_name, company_name)), profile:aluminium_profiles(profile_code)").eq("company_id", cid).order("created_at", { ascending: false }).limit(5),
    supabase.from("production_jobs").select("id, actual_quantity_kg", { count: "exact" }).eq("company_id", cid).eq("status", "completed").gte("completed_at", monthStartIso).lt("completed_at", tomorrowStartIso),
    supabase.from("finishing_jobs").select("id", { count: "exact", head: true }).eq("company_id", cid).in("status", ["planned", "sent_to_vendor", "in_process", "received", "rejected"]),
    supabase.from("production_jobs").select("id", { count: "exact", head: true }).eq("company_id", cid).in("status", ["planned", "in_progress"]).lt("planned_date", today),
    supabase.from("production_jobs").select("id", { count: "exact", head: true }).eq("company_id", cid).in("status", ["planned", "in_progress"]).is("machine_id", null),
    supabase
      .from("orders")
      .select("id, order_number, priority, current_stage, expected_dispatch_date, billets_required, billets_allocated, billets_short, billet_allocation_status, production_profile_id, customers(company_name, customer_name), production_profile:aluminium_profiles!orders_production_profile_id_fkey(profile_code, profile_name), production_die:dies!orders_production_die_id_fkey(die_number, die_status, profile_id)")
      .eq("company_id", cid)
      .in("current_stage", ["order_confirmed", "die_ready", "billet_ready", "billet_heating", "extrusion_planned"])
      .order("expected_dispatch_date", { ascending: true, nullsFirst: false })
      .limit(8),
    supabase
      .from("production_jobs")
      .select("id, job_number, status, planned_date, planned_quantity_kg, machine:machines(machine_name), order:orders(order_number)")
      .eq("company_id", cid)
      .eq("planned_date", today)
      .in("status", ["planned", "ready", "in_progress", "on_hold"])
      .order("created_at", { ascending: true })
      .limit(8),
  ]);

  const lineQueue = canReadLineSchedule(context.role) && !context.dealerId ? await loadLineDeliveryQueue(supabase, "production") : null;
  const queryError = [allJobs, recentJobs, monthlyCompleted, finishing, overdueJobs, noMachine, readinessOrders, todayScheduleJobs]
    .map((result) => result.error)
    .find(Boolean);
  if (queryError) throw new Error(`Could not load the production overview: ${queryError.message}`);

  const rows = allJobs.data ?? [];
  const todayJobs = rows.filter((r: any) => r.planned_date === today);
  const plannedQty = rows.filter((r: any) => ["planned", "in_progress"].includes(r.status)).reduce((sum: number, r: any) => sum + Number(r.planned_quantity_kg ?? 0), 0);

  // Status breakdown
  const statusMap: Record<string, number> = {};
  for (const r of rows) { const s = (r as any).status ?? "planned"; statusMap[s] = (statusMap[s] ?? 0) + 1; }
  const statusBreakdown = Object.entries(statusMap).map(([status, count]) => ({ status, count }));

  const completedRows = monthlyCompleted.data ?? [];
  const monthlyCompletedKg = completedRows.reduce((sum: number, r: any) => sum + Number(r.actual_quantity_kg ?? 0), 0);

  const productionTrend = rows.filter((j: any) => j.status === "completed").map((j: any) => ({
    date: j.completed_at,
    value: Number(j.actual_quantity_kg ?? 0)
  }));

  const allJobsData = rows.map((j: any) => ({
    machine_name: j.machine?.machine_name || "Unassigned",
    planned_quantity_kg: Number(j.planned_quantity_kg ?? 0),
    actual_quantity_kg: Number(j.actual_quantity_kg ?? 0),
    status: j.status
  }));

  return (
    <div className="space-y-2">
      {!context.dealerId ? <Link href="/production/usage" className="inline-flex rounded-xl border bg-white px-4 py-3 text-sm font-bold">Record machine time and energy</Link> : null}
      {!context.dealerId && ["owner","admin","production_manager","production","factory_manager"].includes(context.role) ? <Link href="/production/workstation" className="inline-flex rounded-xl border bg-white px-4 py-3 text-sm font-bold">Open press workstation</Link> : null}
      <ModuleOverviewClient moduleKey="production" context={context} canCreate={can(context.role, "create", "production")} canUpdate={can(context.role, "update", "production")} hideMetricsAndCharts={true}>
        <ProductionDashboard
          totalJobs={rows.length}
          todayJobCount={todayJobs.length}
          plannedQuantityKg={plannedQty}
          completedMtdCount={monthlyCompleted.count ?? 0}
          overdueCount={overdueJobs.count ?? 0}
          noMachineCount={noMachine.count ?? 0}
          statusBreakdown={statusBreakdown}
          recentJobs={(recentJobs.data ?? []) as any}
          monthlyCompletedKg={monthlyCompletedKg}
          monthlyCount={monthlyCompleted.count ?? 0}
          productionTrend={productionTrend}
          allJobs={allJobsData}
        />
        <ProductionReadinessQueue orders={(readinessOrders.data ?? []) as any} todayJobs={(todayScheduleJobs.data ?? []) as any} />
      </ModuleOverviewClient>
      {lineQueue ? <LineDeliveryQueue scope="production" initial={lineQueue.data} unavailableMessage={lineQueue.message} /> : null}
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Finishing Control</p><h2 className="section-title mt-1">Powder Coating / Anodizing Queue</h2><p className="mt-1 text-sm font-medium text-slate-500">{finishing.count ?? 0} open finishing job{(finishing.count ?? 0) === 1 ? "" : "s"} need vendor, receipt, rejection, or completion tracking.</p></div>
          <Link href="/production/finishing" className="inline-flex items-center justify-center rounded-xl bg-charcoal px-4 py-2.5 text-sm font-bold text-white transition hover:bg-charcoal/90">Open Finishing Board</Link>
        </div>
      </div>
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Shift Control</p><h2 className="section-title mt-1">Shift Handover</h2><p className="mt-1 text-sm font-medium text-slate-500">Pass held and running jobs, downtime, exceptions, quality items and pending loads to the next shift, and record that they received it.</p></div>
          <div className="flex flex-wrap gap-2">{canBulkJobs(context.role) && !context.dealerId ? <Link href="/production/bulk" className="inline-flex items-center justify-center rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700">Bulk reschedule</Link> : null}<Link href="/production/handover" className="inline-flex items-center justify-center rounded-xl bg-charcoal px-4 py-2.5 text-sm font-bold text-white transition hover:bg-charcoal/90">Open Handovers</Link></div>
        </div>
      </div>
      <div className="rounded-3xl border border-cyan-200 bg-gradient-to-br from-cyan-50 to-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="text-xs font-black uppercase tracking-[0.16em] text-cyan-700">Press Load Consolidation</p><h2 className="section-title mt-1">Sub-700 kg Production Queue</h2><p className="mt-1 text-sm font-medium text-slate-600">Combine compatible small jobs before press scheduling to reduce changeovers and improve practical batch size.</p></div>
          <Link href="/production/consolidation" className="inline-flex items-center justify-center rounded-xl bg-cyan-700 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-cyan-800">Open Consolidation Queue</Link>
        </div>
      </div>
    </div>
  );
}
