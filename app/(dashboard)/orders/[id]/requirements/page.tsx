import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { RequirementAcknowledge } from "@/components/modules/orders/customer-requirements";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canReviewRequirements, customerRequirementsListSchema, WORK_STAGES } from "@/lib/workflow/customer-step-requirements";
import { WorkListControls } from "@/components/modules/tasks/work-list-controls";

export default async function OrderRequirementsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ stage?: string; page?: string; search?: string; status?: string; sort?: string }> }) {
  const [{ id }, q, c] = await Promise.all([params, searchParams, getSessionContext()]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const permitted = WORK_STAGES.filter(s => canReviewRequirements(c.role, s));
  if (c.dealerId || !permitted.length) redirect("/orders");
  const stage = permitted.find(s => s === q.stage) ?? permitted[0];
  const page = Math.min(Math.max(Number.parseInt(q.page ?? "1", 10) || 1, 1), 100000);
  const search = (q.search ?? "").slice(0, 80); const status = ["required", "advisory", "reviewed", "needs_review"].includes(q.status ?? "") ? q.status! : "all"; const sort = q.sort === "revision" ? "revision" : "name";
  const pageHref = (value: number) => `?${new URLSearchParams({ search, status, sort, stage, page: String(value) })}`;
  const controls = <WorkListControls key={`${search}:${status}:${sort}:${stage}`} search={search} sort={sort} sorts={[{ value: "name", label: "Requirement name" }, { value: "revision", label: "Latest revision" }]} filter={status} filters={[{ value: "all", label: "All requirements" }, { value: "required", label: "Required" }, { value: "advisory", label: "Advisory" }, { value: "reviewed", label: "Reviewed" }, { value: "needs_review", label: "Needs review" }]} hidden={{ stage }} />;
  const client = await createClient(); const r = await client.rpc("customer_requirement_command", { p_command: "order.list", p_payload: { order_id: id, stage, page, search, status, sort } });
  const data = !r.error ? customerRequirementsListSchema.safeParse(r.data).data : null;
  return <div className="space-y-5"><PageHeader title={`Customer requirements / ${stage}`} description="Review the current specification and record how it will be met for this order. A revised requirement needs a new acknowledgement before the next restricted transition." actions={<Link className="text-sm font-bold underline" href={`/orders/${id}`}>Order</Link>} /><nav className="flex flex-wrap gap-3">{permitted.map(s => <Link key={s} className={`rounded-xl border px-4 py-2 text-sm font-bold ${s === stage ? "border-orange bg-orange/10" : "border-slate-200 bg-white"}`} href={`?stage=${s}`}>{s}</Link>)}</nav>{controls}{data ? data.rows.length ? data.rows.map(i => <RequirementAcknowledge key={`${i.id}:${i.revision}:${stage}:${Boolean(i.acknowledgement)}`} orderId={id} stage={stage} item={i} />) : <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">No active customer requirements apply at this work step.</p> : <p role="alert">The customer requirements could not be loaded. Refresh to retry.</p>}{data && data.total_count > 10 ? <nav className="flex justify-between text-sm">{page > 1 ? <Link href={pageHref(page - 1)}>Previous</Link> : <span />}<span>Page {page}</span>{page * 10 < data.total_count ? <Link href={pageHref(page + 1)}>Next</Link> : <span />}</nav> : null}</div>;
}
