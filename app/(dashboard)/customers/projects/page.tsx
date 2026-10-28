import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils/format";
import { PROJECT_STATUSES, canManageProjects, canReadProjects, projectListSchema, type ProjectStatus } from "@/lib/workflow/customer-projects";

// UPGRADE_EOS feature 43: customer projects and delivery sites, searchable, 10 per page.
export default async function CustomerProjectsPage({ searchParams }: { searchParams: Promise<{ page?: string; q?: string; status?: string }> }) {
  const context = await getSessionContext();
  if (context.dealerId || !canReadProjects(context.role)) redirect("/dashboard");
  const params = await searchParams;
  const page = Math.min(Math.max(Number.parseInt(params.page ?? "1", 10) || 1, 1), 100000);
  const search = (params.q ?? "").trim().slice(0, 80);
  const status = Object.hasOwn(PROJECT_STATUSES, params.status ?? "") ? (params.status as ProjectStatus) : undefined;
  const supabase = await createClient();
  const result = await supabase.rpc("customer_project_command", { p_command: "project.list", p_payload: { page, search, ...(status ? { status } : {}) } });
  const parsed = result.error ? null : projectListSchema.safeParse(result.data);
  const unavailable = Boolean(result.error && ["PGRST202", "42883", "42P01"].includes(result.error.code ?? ""));
  const list = parsed?.success ? parsed.data : null;
  const totalPages = list ? Math.max(1, Math.ceil(list.total_count / 10)) : 1;
  const href = (nextPage: number) => {
    const query = new URLSearchParams({ page: String(nextPage) });
    if (search) query.set("q", search);
    if (status) query.set("status", status);
    return `/customers/projects?${query.toString()}`;
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Projects and Sites"
        description="Group a customer's quotations, orders and dispatches under one project or delivery site. Only explicitly linked records appear in a project."
        actions={canManageProjects(context.role) ? <Link href="/customers/projects/new" className="inline-flex items-center rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-bold text-white">New project</Link> : null}
      />
      <form className="flex flex-wrap items-end gap-2" action="/customers/projects">
        <label className="min-w-[220px] flex-1 space-y-1"><span className="form-label">Search code, project, site, city or customer</span>
          <input name="q" className="form-input" maxLength={80} defaultValue={search} />
        </label>
        <label className="space-y-1"><span className="form-label">Status</span>
          <select name="status" className="form-input" defaultValue={status ?? ""}>
            <option value="">All</option>
            {Object.entries(PROJECT_STATUSES).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
          </select>
        </label>
        <button type="submit" className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">Search</button>
      </form>
      {!list ? (
        <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
          {unavailable ? "Projects are not available on this database yet. The database upgrade must be applied first." : "Projects could not be loaded. Refresh to retry."}
        </p>
      ) : !list.rows.length ? (
        <EmptyState title={search || status ? "No matching projects" : "No projects yet"} description={search || status ? "Try a different search or status." : "Create a project to group a customer's site work."} />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="bg-slate-50 text-xs font-black uppercase tracking-[0.08em] text-slate-500">
              <tr><th className="px-4 py-3">Project</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Site</th><th className="px-4 py-3">Linked</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Updated</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.rows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3"><Link href={`/customers/projects/${row.id}`} className="font-bold underline-offset-2 hover:underline">{row.name}</Link><p className="text-xs text-slate-500">{row.project_code}</p></td>
                  <td className="px-4 py-3 text-slate-700">{row.customer_name ?? "-"}</td>
                  <td className="px-4 py-3 text-slate-600">{[row.site_name, row.city].filter(Boolean).join(", ") || "-"}</td>
                  <td className="px-4 py-3">{row.order_count} order{row.order_count === 1 ? "" : "s"} · {row.link_count} record{row.link_count === 1 ? "" : "s"}</td>
                  <td className="px-4 py-3 font-semibold">{PROJECT_STATUSES[row.status as ProjectStatus] ?? row.status}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDate(row.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list && totalPages > 1 ? (
        <nav className="flex items-center justify-between text-sm font-bold" aria-label="Pages">
          {page > 1 ? <Link href={href(page - 1)} className="rounded-xl border border-slate-200 bg-white px-3 py-2">Previous</Link> : <span />}
          <span className="text-slate-500">Page {page} of {totalPages} · {list.total_count} projects</span>
          {page < totalPages ? <Link href={href(page + 1)} className="rounded-xl border border-slate-200 bg-white px-3 py-2">Next</Link> : <span />}
        </nav>
      ) : null}
    </div>
  );
}
