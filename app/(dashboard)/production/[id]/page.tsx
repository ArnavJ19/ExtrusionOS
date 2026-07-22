import { notFound, redirect } from "next/navigation";
import { RecordDetailClient } from "@/components/modules/operations/record-detail-client";
import { ProductionOutputWorkflow } from "@/components/modules/production-output-workflow";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";

export default async function ProductionJobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSessionContext();
  if (!can(context.role, "read", "production")) redirect("/dashboard");

  const supabase = await createClient();
  const [jobResult, billetResult] = await Promise.all([
    supabase
      .from("production_jobs")
      .select("id, job_number, status, planned_quantity_kg, pieces, length_per_piece_m, actual_quantity_kg, actual_pieces, actual_meters, finishing_type")
      .eq("company_id", context.companyId)
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("foundry_billets")
      .select("id, weight_kg")
      .eq("company_id", context.companyId)
      .eq("production_job_id", id)
  ]);
  const job = jobResult.data;
  if (jobResult.error || !job) notFound();
  if (billetResult.error) throw new Error("Could not load linked billet input for this production job.");
  const linkedBillets = billetResult.data ?? [];
  const floorJob = {
    ...job,
    linked_billet_count: linkedBillets.length,
    linked_billet_input_kg: linkedBillets.reduce((sum, billet) => sum + Number(billet.weight_kg ?? 0), 0)
  };

  const canUpdate = can(context.role, "update", "production");
  return (
    <div className="space-y-6">
      <ProductionOutputWorkflow job={floorJob} canUpdate={canUpdate} />
      <RecordDetailClient moduleKey="production" context={context} recordId={id} canEdit={canUpdate} />
    </div>
  );
}
