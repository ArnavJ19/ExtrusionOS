import { RecordFollow } from "@/components/modules/notifications/record-follow";
import { canFollow } from "@/lib/workflow/subscriptions";
import { WorkRequirementsPanel } from "@/components/modules/orders/work-requirements-panel";
import { notFound, redirect } from "next/navigation";
import { RecordDetailClient } from "@/components/modules/operations/record-detail-client";
import { ProductionOutputWorkflow } from "@/components/modules/production-output-workflow";
import { ErpControlPanel } from "@/components/modules/erp-control-panel";
import { productionJobControls } from "@/lib/workflow/erp-control-panels";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { ProductionExceptions } from "@/components/modules/operations/operator-tools";
import { ProductionPerformancePanel } from "@/components/modules/production-performance-panel";
import { buildProductionJobEvidence } from "@/lib/calculations/production-performance";
import { ProductionReadinessPanel } from "@/components/modules/production/production-readiness-panel";
import { canPlaceHolds, canReadHolds, readinessResponseSchema, type ReadinessResponse } from "@/lib/workflow/production-readiness";

const SCRAP_RECORD_LIMIT = 200;

export default async function ProductionJobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSessionContext();
  if (!can(context.role, "read", "production")) redirect("/dashboard");

  const supabase = await createClient();
  const [jobResult, billetResult, scrapResult, exceptionResult] = await Promise.all([
    supabase
      .from("production_jobs")
      .select("id, job_number, status, planned_quantity_kg, pieces, length_per_piece_m, actual_quantity_kg, actual_pieces, actual_meters, finishing_type, order_id, die_id, machine_id, profile_id")
      .eq("company_id", context.companyId)
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("foundry_billets")
      .select("id, weight_kg, measured_weight_kg, status")
      .eq("company_id", context.companyId)
      .eq("production_job_id", id),
    supabase
      .from("scrap_records")
      .select("id, weight_kg")
      .eq("company_id", context.companyId)
      .eq("production_job_id", id)
      .limit(SCRAP_RECORD_LIMIT + 1),
    supabase
      .from("production_input_exceptions")
      .select("id")
      .eq("company_id", context.companyId)
      .eq("production_job_id", id)
      .maybeSingle()
  ]);
  const job = jobResult.data;
  if (jobResult.error || !job) notFound();
  if (billetResult.error) throw new Error("Could not load linked billet input for this production job.");
  const linkedBillets = billetResult.data ?? [];
  const scrapRecords = scrapResult.error || (scrapResult.data ?? []).length > SCRAP_RECORD_LIMIT ? null : scrapResult.data ?? [];
  const reversalResult = scrapRecords && scrapRecords.length
    ? await supabase.from("scrap_record_reversals").select("scrap_record_id, reversed_weight_kg").eq("company_id", context.companyId).in("scrap_record_id", scrapRecords.map((record) => record.id))
    : { data: [], error: null };
  const evidence = buildProductionJobEvidence({
    status: job.status,
    plannedOutputKg: job.planned_quantity_kg,
    actualOutputKg: job.actual_quantity_kg,
    billets: linkedBillets,
    scrapRecords,
    reversals: reversalResult.error ? null : reversalResult.data ?? [],
    inputExceptionRecorded: Boolean(exceptionResult.data)
  });
  // Same billet statuses and measured-else-nominal weight basis as the completion transaction.
  const floorJob = {
    ...job,
    linked_billet_count: evidence.billetInput.count,
    linked_billet_input_kg: evidence.billetInput.inputKg,
    existing_scrap_kg: evidence.scrapKg === null ? null : evidence.scrapKg + evidence.reversedScrapKg
  };

  const canUpdate = can(context.role, "update", "production");
  const canCorrect = ["owner", "admin", "production_manager"].includes(context.role);
  const controls = await productionJobControls(supabase, context, id);
  // UPGRADE_EOS features 63 and 72: readiness is computed by the database with its start rules.
  const showReadiness = !context.dealerId && canReadHolds(context.role);
  let readiness: ReadinessResponse | null = null;
  let readinessMessage: string | null = null;
  let people: { id: string; name: string }[] = [];
  if (showReadiness) {
    const [readinessResult, peopleResult] = await Promise.all([
      supabase.rpc("production_hold_command", { p_command: "holds.readiness", p_payload: { job_id: id } }),
      canPlaceHolds(context.role)
        ? supabase.from("app_users").select("id, full_name").eq("company_id", context.companyId).eq("is_active", true).is("dealer_id", null)
          .in("role", ["owner", "admin", "factory_manager", "production_manager", "production", "quality"]).order("full_name").limit(200)
        : Promise.resolve({ data: [], error: null })
    ]);
    const parsed = readinessResponseSchema.safeParse(readinessResult.data);
    if (readinessResult.error) {
      readinessMessage = ["PGRST202", "42883", "42P01"].includes(readinessResult.error.code ?? "")
        ? "Readiness and hold tools are not available on this database yet. The database upgrade must be applied first."
        : "Readiness could not be checked. Refresh before starting this job.";
    } else if (parsed.success) readiness = parsed.data;
    people = (peopleResult.data ?? []).map((person: { id: string; full_name: string | null }) => ({ id: person.id, name: person.full_name || "Employee" }));
  }
  return (
    <div id="production-readiness" className="space-y-6">
      <ProductionOutputWorkflow job={floorJob} canUpdate={canUpdate} canCorrect={canCorrect} />
      {!context.dealerId ? <WorkRequirementsPanel companyId={context.companyId} role={context.role} stage="production" orderId={job.order_id} /> : null}
      {!context.dealerId && canFollow(context.role, "production_job") ? <RecordFollow entityType="production_job" entityId={id} /> : null}
      <ProductionPerformancePanel evidence={evidence} />
      {showReadiness ? (
        <ProductionReadinessPanel
          key={`${context.companyId}:${context.userId}:${id}`}
          jobId={id}
          initial={readiness}
          unavailableMessage={readinessMessage}
          links={{ jobId: id, orderId: job.order_id, dieId: job.die_id, machineId: job.machine_id, profileId: job.profile_id }}
          canWrite={canPlaceHolds(context.role)}
          people={people}
        />
      ) : null}
      <div id="production-controls"><ErpControlPanel title="Production controls" description="Billet issue, input evidence, surplus to stock and scrap corrections." actions={controls} /></div>
      <ProductionExceptions key={`${context.companyId}:${context.userId}:${context.role}:${id}`} context={context} jobId={id} />
      <RecordDetailClient moduleKey="production" context={context} recordId={id} canEdit={canUpdate} />
    </div>
  );
}
