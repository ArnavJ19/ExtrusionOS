import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canManageCustomerRequirements, customerRequirementsListSchema } from "@/lib/workflow/customer-step-requirements";
import { WorkListControls } from "@/components/modules/tasks/work-list-controls";

export default async function CustomerRequirementsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string; search?: string; status?: string; sort?: string }> }) {
  const [{ id }, q, c] = await Promise.all([params, searchParams, getSessionContext()]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  if (c.dealerId || !canManageCustomerRequirements(c.role)) redirect("/customers");
  const page = Math.min(Math.max(Number.parseInt(q.page ?? "1", 10) || 1, 1), 100000);
  const search = (q.search ?? "").slice(0, 80); const status = ["active", "inactive", "required", "advisory"].includes(q.status ?? "") ? q.status! : "all"; const sort = q.sort === "revision" ? "revision" : "name";
  const pageHref = (value: number) => `?${new URLSearchParams({ search, status, sort, page: String(value) })}`;
  const controls = <WorkListControls key={`${search}:${status}:${sort}`} search={search} sort={sort} sorts={[{ value: "name", label: "Requirement name" }, { value: "revision", label: "Latest revision" }]} filter={status} filters={[{ value: "all", label: "All requirements" }, { value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }, { value: "required", label: "Required" }, { value: "advisory", label: "Advisory" }]} />;
  const client = await createClient(); const r = await client.rpc("customer_requirement_command", { p_command: "customer.list", p_payload: { customer_id: id, page, search, status, sort } });
  const data = !r.error ? customerRequirementsListSchema.safeParse(r.data).data : null;
  return <div className="space-y-5"><PageHeader title="Customer work requirements" description="Specifications, certificates and packing instructions shown at the relevant production, quality, packing and dispatch steps." actions={<div className="flex gap-3 text-sm font-bold"><Link className="underline" href={`/customers/${id}/requirements/new`}>New requirement</Link><Link className="underline" href={`/customers/${id}`}>Customer</Link></div>} />{controls}<section className="rounded-3xl border border-slate-200 bg-white p-5">{data ? data.rows.length ? <ul className="divide-y divide-slate-100">{data.rows.map(i => <li key={i.id}><Link className="block space-y-1 py-3 text-sm" href={`/customers/${id}/requirements/new?edit=${i.id}&page=${page}`}><p className="font-bold">{i.certificate_type} / revision {i.revision} / {i.is_active ? "active" : "inactive"}</p><p>{i.description}</p><p className="text-xs text-slate-500">{i.work_stages.join(", ")} / {i.is_mandatory ? "review required" : "advisory"}</p></Link></li>)}</ul> : <p className="text-sm">No customer work requirements match this view.</p> : <p role="alert">Customer requirements could not be loaded.</p>}{data && data.total_count > 10 ? <nav className="mt-4 flex justify-between text-sm">{page > 1 ? <Link href={pageHref(page - 1)}>Previous</Link> : <span />}<span>Page {page}</span>{page * 10 < data.total_count ? <Link href={pageHref(page + 1)}>Next</Link> : <span />}</nav> : null}</section></div>;
}
