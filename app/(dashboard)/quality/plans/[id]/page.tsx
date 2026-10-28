import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { PlanDecision, PlanEditor } from "@/components/modules/quality/inspection-plans";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils/format";
import { canEditPlans, canReadPlans, limitText, planDetailSchema } from "@/lib/workflow/inspection-plans";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function InspectionPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSessionContext();
  if (context.dealerId || !canReadPlans(context.role)) redirect("/quality");
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();
  const result = await supabase.rpc("inspection_plan_command", { p_command: "plan.load", p_payload: { plan_id: id } });
  if (result.error?.message === "Inspection plan is unavailable") notFound();
  if (result.error) throw new Error("The plan could not be loaded. Refresh to retry.");
  const plan = planDetailSchema.parse(result.data);
  const editable = plan.status === "draft" && canEditPlans(context.role);
  // Four eyes: quality staff approve drafts written by someone else.
  const canApprove = editable && (["owner", "admin"].includes(context.role) || plan.created_by !== context.userId);

  return (
    <div className="space-y-5">
      <PageHeader title={`${plan.profile_code ?? "Company default"} · version ${plan.version}`}
        description={plan.status === "approved" ? `Approved by ${plan.approved_by_name ?? "-"} on ${formatDate(plan.approved_at)}. In use for new inspections.` : plan.status === "superseded" ? `Superseded on ${formatDate(plan.superseded_at)}.` : "Draft: not used until approved."}
        actions={<Link href="/quality/plans" className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">All plans</Link>} />
      {editable ? (
        <>
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <PlanDecision planId={plan.id} canApprove={canApprove} />
            {!canApprove ? <p className="mt-2 text-xs font-semibold text-slate-600">You drafted this version, so another quality employee or an owner/admin must approve it.</p> : null}
          </section>
          <PlanEditor planId={plan.id} profiles={[]} initial={plan} />
        </>
      ) : (
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-700">Sampling: {plan.sampling_instruction}</p>
          <ul className="mt-3 divide-y divide-slate-100 text-sm">
            {plan.items.map((item) => (
              <li key={item.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span className="font-bold">{item.seq}. {item.characteristic}{item.method ? <span className="ml-2 font-normal text-slate-500">{item.method}</span> : null}</span>
                <span className="text-slate-600">{limitText(item)}{item.nominal !== null ? ` · nominal ${item.nominal}` : ""}</span>
              </li>
            ))}
          </ul>
          {plan.status === "approved" && canEditPlans(context.role) ? <p className="mt-3 text-xs text-slate-500">To change an approved plan, create a new draft for the same profile from New plan; it replaces this version once approved.</p> : null}
        </section>
      )}
    </div>
  );
}
