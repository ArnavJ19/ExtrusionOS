import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { ResolveException } from "@/components/modules/tasks/task-blueprints";
import { WorkListControls } from "@/components/modules/tasks/work-list-controls";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils/format";
import { blueprintsListSchema, canManageBlueprints, describeKind, exceptionsListSchema, roleLabel } from "@/lib/workflow/task-blueprints";

// UPGRADE_EOS feature 61: the blueprint for each task kind, and exceptions routed to me.
export default async function BlueprintsPage({ searchParams }: { searchParams: Promise<{ status?: string; page?: string; search?: string; sort?: string; active?: string; blueprintPage?: string }> }) {
  const context = await getSessionContext();
  if (context.dealerId || !can(context.role, "read", "tasks")) redirect("/tasks");
  const params = await searchParams;
  const status = params.status === "resolved" ? "resolved" : "open";
  const page = Math.min(Math.max(Number.parseInt(params.page ?? "1", 10) || 1, 1), 100000);
  const blueprintPage = Math.min(Math.max(Number.parseInt(params.blueprintPage ?? "1", 10) || 1, 1), 100000);
  const search = (params.search ?? "").slice(0, 80);
  const active = ["active", "inactive"].includes(params.active ?? "") ? params.active! : "all";
  const sort = ["title", "updated"].includes(params.sort ?? "") ? params.sort! : "kind";
  const blueprintHref = (value: number) => `?${new URLSearchParams({ search, active, sort, blueprintPage: String(value), status })}`;
  const supabase = await createClient();
  const [listResult, exceptionsResult] = await Promise.all([
    supabase.rpc("task_blueprint_command", { p_command: "blueprints.list", p_payload: { page: blueprintPage, search, status: active, sort } }),
    supabase.rpc("task_blueprint_command", { p_command: "exceptions.list", p_payload: { status, page } })
  ]);
  const unavailable = Boolean(listResult.error && ["PGRST202", "42883", "42P01"].includes(listResult.error.code ?? ""));
  const list = listResult.error ? null : blueprintsListSchema.safeParse(listResult.data);
  const exceptions = exceptionsResult.error ? null : exceptionsListSchema.safeParse(exceptionsResult.data).data ?? null;
  const manager = canManageBlueprints(context.role);
  const totalPages = exceptions ? Math.max(1, Math.ceil(exceptions.total_count / 10)) : 1;
  return (
    <div className="space-y-5">
      <PageHeader title="Task blueprints" description="Every kind of task follows the same structure: purpose, trigger, inputs, responsible roles, prerequisites, steps, completion evidence and an exception route. Prerequisites are checked by the system when work starts."
        actions={<div className="flex flex-wrap gap-2">{manager ? <Link href="/tasks/blueprints/new" className="rounded-xl bg-charcoal px-4 py-2.5 text-sm font-bold text-white">New blueprint</Link> : null}<Link href="/tasks" className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">All tasks</Link></div>} />
      <WorkListControls key={`${search}:${sort}:${active}`} search={search} sort={sort} sorts={[{ value: "kind", label: "Task kind" }, { value: "title", label: "Title" }, { value: "updated", label: "Recently updated" }]} filter={active} filterName="active" filters={[{ value: "all", label: "All blueprints" }, { value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]} hidden={{ status }} />
      {!list?.success ? (
        <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{unavailable ? "Task blueprints are not available on this database yet. The database upgrade must be applied first." : "Task blueprints could not be loaded. Refresh to retry."}</p>
      ) : (
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-bold text-slate-900">Blueprints</h2>
          {list.data.rows.length ? (
            <ul className="mt-2 divide-y divide-slate-100 text-sm">
              {list.data.rows.map((b) => (
                <li key={b.id} className="py-2"><Link href={`/tasks/blueprints/${b.id}`} className="flex flex-wrap justify-between gap-2 hover:underline">
                  <span className="min-w-0 break-words font-bold">{b.title} <span className="font-normal text-slate-500">· {describeKind(b.task_kind)}</span></span>
                  <span className="text-xs font-semibold text-slate-600">{b.is_active ? "Active" : "Inactive"} · rev {b.revision} · {b.responsible_roles.map(roleLabel).join(", ")} · {b.prerequisite_count} prerequisite{b.prerequisite_count === 1 ? "" : "s"}{b.open_exceptions ? ` · ${b.open_exceptions} open exception${b.open_exceptions === 1 ? "" : "s"}` : ""}</span>
                </Link></li>
              ))}
            </ul>
          ) : <p className="mt-2 text-sm text-slate-500">No blueprints match this view.{manager ? " Create one for a recurring task kind or change the filters." : ""}</p>}
          {list.data.total_count > 10 ? <nav aria-label="Blueprint pages" className="mt-4 flex justify-between text-sm font-semibold">{blueprintPage > 1 ? <Link href={blueprintHref(blueprintPage - 1)}>Previous</Link> : <span />}<span>Page {blueprintPage} of {Math.ceil(list.data.total_count / 10)}</span>{blueprintPage * 10 < list.data.total_count ? <Link href={blueprintHref(blueprintPage + 1)}>Next</Link> : <span />}</nav> : null}
        </section>
      )}
      <section id="exceptions" className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-bold text-slate-900">{status === "open" ? "Open exceptions" : "Resolved exceptions"}</h2>
          <Link href={`?status=${status === "open" ? "resolved" : "open"}#exceptions`} className="text-sm font-semibold underline">{status === "open" ? "Show resolved" : "Show open"}</Link>
        </div>
        {exceptions ? (exceptions.rows.length ? (
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {exceptions.rows.map((x) => (
              <li key={x.id} className="py-3">
                <Link href={`/tasks/${x.task_id}`} className="font-bold hover:underline">{x.task_title}</Link>
                <p className="text-slate-700">{x.reason}</p>
                <p className="text-xs text-slate-500">Routed to {roleLabel(x.routed_role)} by {x.raised_by_name} · {formatDate(x.raised_at)}{x.resolution ? ` · Resolved by ${x.resolved_by_name}: ${x.resolution}` : ""}</p>
                {x.status === "open" && x.can_resolve ? <ResolveException exceptionId={x.id} /> : null}
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-sm text-slate-500">No {status} exceptions for you.</p>) : <p className="mt-2 text-sm text-slate-500">Exceptions could not be loaded.</p>}
        {totalPages > 1 ? <nav className="mt-3 flex justify-between text-sm font-semibold">{page > 1 ? <Link href={`?status=${status}&page=${page - 1}#exceptions`} className="underline">Previous</Link> : <span />}<span>Page {page} of {totalPages}</span>{page < totalPages ? <Link href={`?status=${status}&page=${page + 1}#exceptions`} className="underline">Next</Link> : <span />}</nav> : null}
      </section>
    </div>
  );
}
