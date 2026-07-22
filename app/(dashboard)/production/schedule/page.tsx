import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { PressScheduleGrid } from "@/components/modules/production-planning/press-schedule-grid";
import { ModuleDisabled } from "@/components/ui/module-disabled";
import { EmptyState } from "@/components/ui/empty-state";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { getFeatureFlagsForCompany, isFeatureEnabled } from "@/lib/enterprise/features";
import { createClient } from "@/lib/supabase/server";

export default async function ProductionSchedulePage() {
  const context = await getSessionContext();
  const supabase = await createClient();
  const flags = await getFeatureFlagsForCompany(supabase, context.companyId);
  if (!isFeatureEnabled(flags, "production_planning")) return <ModuleDisabled moduleName="production_planning" title="Production Schedule" />;
  if (!can(context.role, "read", "production")) redirect("/dashboard");

  const now = new Date();
  const windowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).toISOString();
  const windowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 14).toISOString();

  const [pressesResult, jobsResult, slotsResult] = await Promise.all([
    supabase
      .from("machines")
      .select("id, machine_name, machine_type, status, press_capacity_ton")
      .eq("company_id", context.companyId)
      .eq("machine_type", "extrusion_press")
      .eq("is_active", true)
      .in("status", ["active", "operational", "idle"])
      .order("machine_name", { ascending: true }),
    supabase
      .from("production_jobs")
      .select("id, job_number, status, planned_date, planned_quantity_kg, shift, machine_id, order:orders(order_number, priority, customers(company_name, customer_name)), profile:aluminium_profiles(profile_code, profile_name), die:dies(die_number)")
      .eq("company_id", context.companyId)
      .in("status", ["planned", "ready", "in_progress", "on_hold"])
      .order("planned_date", { ascending: true, nullsFirst: true })
      .limit(200),
    supabase
      .from("production_plan_slots")
      .select("id, production_job_id, machine_id, planned_start_at, planned_end_at, shift, sequence_number, capacity_kg, status")
      .eq("company_id", context.companyId)
      .gte("planned_start_at", windowStart)
      .lte("planned_start_at", windowEnd)
      .neq("status", "cancelled")
      .order("planned_start_at", { ascending: true })
  ]);

  if (pressesResult.error) throw pressesResult.error;
  if (jobsResult.error) throw jobsResult.error;
  if (slotsResult.error) throw slotsResult.error;

  const presses = (pressesResult.data ?? []) as any[];
  const jobs = (jobsResult.data ?? []) as any[];
  const slots = (slotsResult.data ?? []) as any[];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Production Schedule"
        description="Assign order-backed extrusion jobs to available presses, shifts, and release slots."
      />
      {!presses.length ? (
        <EmptyState title="No extrusion presses available" description="Add active extrusion presses in Machines before scheduling production jobs." />
      ) : !jobs.length ? (
        <EmptyState title="No production jobs ready to schedule" description="Create production jobs from open orders, then return here to assign press slots." />
      ) : (
        <PressScheduleGrid presses={presses} jobs={jobs} slots={slots} canUpdate={can(context.role, "update", "production")} />
      )}
    </div>
  );
}
