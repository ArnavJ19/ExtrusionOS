import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { canReviewRequirements, customerRequirementsListSchema, type WorkStage } from "@/lib/workflow/customer-step-requirements";

export async function WorkRequirementsPanel({ companyId, role, stage, orderId, source }: { companyId: string; role: string; stage: WorkStage; orderId?: string | null; source?: { type: "quality_inspection" | "dispatch"; id: string } }) {
  if (!canReviewRequirements(role, stage)) return null;
  const client = await createClient();
  let linkedOrder = orderId;
  if (!linkedOrder && source?.type === "dispatch") {
    const r = await client.from("dispatches").select("order_id").eq("id", source.id).eq("company_id", companyId).maybeSingle();
    linkedOrder = r.data?.order_id;
  } else if (!linkedOrder && source?.type === "quality_inspection") {
    const r = await client.from("quality_inspections").select("production_job_id,finishing_job_id").eq("id", source.id).eq("company_id", companyId).maybeSingle();
    const jobId = r.data?.production_job_id ?? r.data?.finishing_job_id;
    if (jobId) {
      const j = await client.from(r.data?.production_job_id ? "production_jobs" : "finishing_jobs").select("order_id").eq("id", jobId).eq("company_id", companyId).maybeSingle();
      linkedOrder = j.data?.order_id;
    }
  }
  if (!linkedOrder) return null;
  const result = await client.rpc("customer_requirement_command", { p_command: "order.list", p_payload: { order_id: linkedOrder, stage, page: 1 } });
  const data = !result.error ? customerRequirementsListSchema.safeParse(result.data).data : null;
  if (data && data.total_count === 0) return null;
  return <section className="space-y-3 rounded-3xl border border-amber-200 bg-amber-50/60 p-5"><div className="flex flex-wrap justify-between gap-2"><h2 className="font-bold">Customer requirements for {stage}</h2><Link className="text-sm font-bold underline" href={`/orders/${linkedOrder}/requirements?stage=${stage}`}>Review current requirements</Link></div>{data ? <ul className="space-y-2 text-sm">{data.rows.map(r => <li key={r.id}><strong>{r.certificate_type}</strong> / revision {r.revision} / {r.acknowledgement ? `reviewed by ${r.acknowledgement.by}` : r.is_mandatory ? "review required before proceeding" : "advisory"}<p className="whitespace-pre-wrap text-slate-600">{r.description}</p></li>)}{data.total_count > 10 ? <li>{data.total_count - 10} more requirements. Open the full review before proceeding.</li> : null}</ul> : <p role="alert" className="text-sm">Current customer requirements could not be checked. Open the review before proceeding.</p>}</section>;
}
