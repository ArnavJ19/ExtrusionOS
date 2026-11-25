import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { ComplaintLogForm } from "@/components/modules/orchestration/delivery-closure-forms";
import { getSessionContext } from "@/lib/auth";
import { hasRouteAccess } from "@/lib/auth/route-permissions";
import { complaintAction } from "@/lib/actions/orchestration";
import { canLogComplaint, complaintCandidatesSchema } from "@/lib/workflow/delivery-closure";

// Phase 7: log a customer complaint against a dispatched order (and, where known, its dispatch and bundles).
export default async function NewComplaintPage({ searchParams }: { searchParams: Promise<{ order_id?: string }> }) {
  const [q, context] = await Promise.all([searchParams, getSessionContext()]);
  if (context.dealerId || !hasRouteAccess("/quality/complaints", context.role)) redirect("/dashboard");
  if (!canLogComplaint(context.role)) redirect("/quality/complaints");
  const result = await complaintAction({ command: "candidates" });
  const orders = result.success ? complaintCandidatesSchema.safeParse(result.data).data?.orders ?? [] : [];
  // An order passed from a shipment or the lifecycle is offered first.
  let initial = orders;
  if (q.order_id && /^[0-9a-f-]{36}$/i.test(q.order_id) && !orders.some(o => o.id === q.order_id)) {
    const one = await complaintAction({ command: "candidates", order_id: q.order_id });
    const parsed = one.success ? complaintCandidatesSchema.safeParse(one.data).data : null;
    if (parsed?.order) initial = [{ id: parsed.order.id, order_number: parsed.order.order_number, customer: parsed.order.customer, stage: "" }, ...orders];
  }
  return (
    <div className="space-y-5">
      <PageHeader title="Log a customer complaint" backHref="/quality/complaints" backLabel="Back to complaints"
        description="Record what the customer reported, how severe it is and which bundles are affected. Quality complaints draft an NCR for QA; everyone concerned is told at once." />
      {!result.success ? <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{result.error}</p> : <ComplaintLogForm initialOrders={initial} initialOrderId={q.order_id && /^[0-9a-f-]{36}$/i.test(q.order_id) ? q.order_id : undefined} />}
    </div>
  );
}
