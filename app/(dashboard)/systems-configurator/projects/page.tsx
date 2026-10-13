import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { getSystemsConfiguratorContext } from "@/lib/systems-configurator/access";
import { labelize } from "@/types/app";
import { can } from "@/lib/auth/permissions";
import { buildProjectListQuery, getProjectListOptions, projectSortColumns, projectStatuses, projectSystemTypes } from "@/lib/systems-configurator/project-list";
import { QueryErrorNotice } from "@/components/ui/query-error-notice";

export default async function SystemProjectsPage({ searchParams }: { searchParams: Promise<Record<string,string | string[] | undefined>> }) {
  const context = await getSystemsConfiguratorContext("read");
  const supabase = await createClient();
  const options = getProjectListOptions(await searchParams);
  const { data: configurations, error, count } = await buildProjectListQuery(supabase,context.companyId,options);
  const pageHref = (page: number) => {
    const query = new URLSearchParams({page:String(page),q:options.search,status:options.status,system:options.systemType,sort:options.sort,direction:options.direction});
    return `/systems-configurator/projects?${query}`;
  };
  const canSeeValue = ["owner","admin","accounts","sales_manager","sales"].includes(context.role);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader title="System Projects" description="Saved aluminium door/window configurations, draft designs, and future production outputs." />
        {can(context.role,"create","systems_configurator") ? <Link href="/systems-configurator/new" className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-orange/20 transition hover:bg-orange/90"><Plus className="h-4 w-4" /> New Configuration</Link> : null}
      </div>
      <form action="/systems-configurator/projects" className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        <label className="text-xs font-semibold text-slate-600">Search<input name="q" defaultValue={options.search} placeholder="Project, design or configuration" className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label>
        <label className="text-xs font-semibold text-slate-600">Status<select name="status" defaultValue={options.status} className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm"><option value="">All statuses</option>{projectStatuses.map((status)=><option key={status} value={status}>{labelize(status)}</option>)}</select></label>
        <label className="text-xs font-semibold text-slate-600">System<select name="system" defaultValue={options.systemType} className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm"><option value="">All systems</option>{projectSystemTypes.map((type)=><option key={type} value={type}>{labelize(type)}</option>)}</select></label>
        <label className="text-xs font-semibold text-slate-600">Sort<select name="sort" defaultValue={options.sort} className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm">{projectSortColumns.map((sort)=><option key={sort} value={sort}>{labelize(sort)}</option>)}</select></label>
        <select aria-label="Sort direction" name="direction" defaultValue={options.direction} className="rounded-lg border border-slate-200 px-3 py-2 text-sm"><option value="desc">Descending</option><option value="asc">Ascending</option></select>
        <button className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Apply</button>
      </form>
      {error ? <QueryErrorNotice messages={["Saved projects could not be loaded. Retry after the database connection or deployment is restored."]} /> : null}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-black uppercase tracking-[0.12em] text-slate-500">
                <tr><th className="px-5 py-3">Configuration</th><th className="px-5 py-3">System</th><th className="px-5 py-3">Size</th><th className="px-5 py-3">Customer</th><th className="px-5 py-3">Status</th>{canSeeValue ? <th className="px-5 py-3 text-right">Value</th> : null}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(configurations ?? []).map((item: any) => (
                  <tr key={item.id} className="transition hover:bg-orange/5">
                    <td className="px-5 py-4"><Link href={`/systems-configurator/projects/${item.id}`} className="font-black text-slate-950 transition hover:text-orange">{item.configuration_number ?? "Draft"} · {item.design_reference}</Link><p className="mt-1 text-xs font-semibold text-slate-500">{item.project_name}{item.location_label ? ` · ${item.location_label}` : ""}</p></td>
                    <td className="px-5 py-4 font-semibold text-slate-700">{labelize(item.system_type ?? "custom")}<p className="mt-1 text-xs text-slate-500">{item.system_series?.series_code ?? "No series"}</p></td>
                    <td className="px-5 py-4 font-semibold text-slate-700">{item.width_mm} x {item.height_mm} mm<p className="mt-1 text-xs text-slate-500">Qty {item.quantity}</p></td>
                    <td className="px-5 py-4 font-semibold text-slate-700">{item.customers?.company_name || item.customers?.customer_name || (item.customer_id ? "Customer unavailable" : "Walk-in")}</td>
                    <td className="px-5 py-4"><Badge value={item.status ?? "draft"} /></td>
                    {canSeeValue ? <td className="px-5 py-4 text-right font-black text-slate-950">{item.grand_total == null ? "Unavailable" : `Rs. ${Number(item.grand_total).toLocaleString("en-IN")}`}</td> : null}
                  </tr>
                ))}
                {!error && !(configurations ?? []).length ? <tr><td colSpan={canSeeValue ? 6 : 5} className="px-5 py-10 text-center text-sm font-semibold text-slate-500">No configurations match this page or filter.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      {!error ? <nav aria-label="Project pages" className="flex items-center justify-between gap-4 text-sm font-semibold text-slate-600">
        <p>Page {options.page} / {count ?? 0} matching configurations</p>
        <div className="flex gap-3">{options.page > 1 ? <Link href={pageHref(options.page-1)} className="rounded-lg border border-slate-200 px-3 py-2">Previous</Link> : null}{options.page*10 < (count ?? 0) ? <Link href={pageHref(options.page+1)} className="rounded-lg border border-slate-200 px-3 py-2">Next</Link> : null}</div>
      </nav> : <Link href={pageHref(options.page)} className="text-sm font-semibold text-orange">Retry loading projects</Link>}
    </div>
  );
}
