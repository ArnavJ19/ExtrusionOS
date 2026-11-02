import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { canAccessMobileDestination } from "@/lib/auth/role-experience";
import { createClient } from "@/lib/supabase/server";
import { getFeatureFlagsForCompany, isFeatureEnabled } from "@/lib/enterprise/features";
import { inspectionPlanAction } from "@/lib/actions/inspection-plans";
import { canEditPlans, canReadPlans, evaluationSchema } from "@/lib/workflow/inspection-plans";
import { InspectionResultsPanel } from "@/components/modules/quality/inspection-results";
import { ErrorState } from "@/components/ui/error-state";

export default async function MobileInspectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  const context = await getSessionContext();
  if (context.dealerId || !canAccessMobileDestination(context.role, "quality") || !canReadPlans(context.role)) redirect("/dashboard?denied=1");
  const supabase = await createClient();
  const flags = await getFeatureFlagsForCompany(supabase, context.companyId);
  if (!isFeatureEnabled(flags, "quality_compliance")) redirect("/dashboard?denied=1");
  if (!isFeatureEnabled(flags, "mobile_floor_app")) redirect(`/quality/${id}`);
  const record = await supabase.from("quality_inspections").select("id, batch_number, inspector_name").eq("company_id", context.companyId).eq("id", id).maybeSingle();
  if (record.error) return <ErrorState description="The inspection could not be loaded. Refresh to retry; no observations were submitted." />;
  if (!record.data) notFound();
  const result = await inspectionPlanAction({ command: "inspection.plan", inspection_id: id });
  const parsed = result.success ? evaluationSchema.safeParse(result.data) : null;
  return <div className="mx-auto max-w-2xl space-y-4">
    <Link href="/mobile/quality" className="inline-flex min-h-11 items-center rounded-lg px-2 font-semibold underline">Back to quality queue</Link>
    <header className="rounded-2xl border border-neutral-200 bg-white p-4"><p className="text-xs font-semibold uppercase text-neutral-500">Quality observation task</p><h1 className="mt-2 break-words text-2xl font-bold">{record.data.batch_number || "Inspection"}</h1><p className="mt-2 text-sm">{record.data.inspector_name || "Inspector not recorded"}. Record observations, review, then confirm.</p><Link href={`/quality/${id}`} className="mt-2 inline-flex min-h-11 items-center rounded-lg text-sm font-semibold underline">Open full inspection</Link></header>
    {parsed?.success ? <InspectionResultsPanel inspectionId={id} initial={parsed.data} contextScope={`${context.companyId}:${context.userId}:${context.role}`} canRecord={canEditPlans(context.role)} focused referenceHref={parsed.data.state !== "no_plan" ? `/quality/plans/${parsed.data.plan_id}` : undefined} queueHref="/mobile/quality" /> : <ErrorState description={result.success ? "The inspection plan response could not be verified. Refresh before recording observations." : result.error} />}
  </div>;
}
