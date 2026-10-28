import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { ProjectLinkManager } from "@/components/modules/customers/customer-projects";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, formatDate, formatWeight } from "@/lib/utils/format";
import { ENTITY_LABELS, PROJECT_STATUSES, canManageProjects, canReadProjects, projectDetailSchema, projectDispatchShare, type ProjectEntity } from "@/lib/workflow/customer-projects";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const label = (value: string) => value.replace(/_/g, " ");

export default async function CustomerProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSessionContext();
  if (context.dealerId || !canReadProjects(context.role)) redirect("/dashboard");
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();
  const result = await supabase.rpc("customer_project_command", { p_command: "project.load", p_payload: { project_id: id } });
  if (result.error?.message === "Project is unavailable") notFound();
  if (result.error) throw new Error("The project could not be loaded. Refresh to retry.");
  const data = projectDetailSchema.parse(result.data);
  const { project, totals } = data;
  const share = projectDispatchShare(totals);
  const canManage = canManageProjects(context.role);
  const linked = [
    ...data.quotes.map((row) => ({ entity_type: "quote" as ProjectEntity, entity_id: row.id, label: row.number })),
    ...data.orders.map((row) => ({ entity_type: "order" as ProjectEntity, entity_id: row.id, label: row.number })),
    ...data.dispatches.map((row) => ({ entity_type: "dispatch" as ProjectEntity, entity_id: row.id, label: row.number ?? "Dispatch" }))
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={project.name}
        description={`${project.project_code} · ${project.customer_name ?? "Customer"} · ${PROJECT_STATUSES[project.status]}`}
        actions={(
          <>
            <Link href="/customers/projects" className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">All projects</Link>
            {canManage ? <Link href={`/customers/projects/${project.id}/edit`} className="rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-bold text-white">Edit</Link> : null}
          </>
        )}
      />
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Orders (not cancelled)", String(totals.order_count)],
          ["Ordered", formatWeight(totals.ordered_kg)],
          ["Dispatched", `${formatWeight(totals.dispatched_kg)}${share === null ? "" : ` · ${Math.round(share * 100)}%`}`],
          data.can_see_values ? ["Order value", formatCurrency(totals.order_value)] : ["Open quotations", String(totals.open_quote_count)]
        ].map(([title, value]) => (
          <div key={title} className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-bold uppercase tracking-[0.1em] text-slate-500">{title}</p>
            <p className="mt-1 text-lg font-black text-slate-900">{value}</p>
          </div>
        ))}
      </section>
      <p className="text-xs font-medium text-slate-500">Ordered and value count linked orders that are not cancelled. Dispatched counts linked dispatches that have left the factory and were not returned; delivered so far {formatWeight(totals.delivered_kg)}.</p>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-bold text-slate-900">Delivery site</h2>
        <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="inline font-bold">Site: </dt><dd className="inline">{project.site_name ?? "-"}</dd></div>
          <div><dt className="inline font-bold">City / State: </dt><dd className="inline">{[project.city, project.state, project.pincode].filter(Boolean).join(", ") || "-"}</dd></div>
          <div className="sm:col-span-2"><dt className="inline font-bold">Address: </dt><dd className="inline whitespace-pre-wrap">{project.site_address ?? "-"}</dd></div>
          <div><dt className="inline font-bold">Site contact: </dt><dd className="inline">{[project.contact_name, project.contact_phone].filter(Boolean).join(" · ") || "-"}</dd></div>
          {project.notes ? <div className="sm:col-span-2"><dt className="inline font-bold">Notes: </dt><dd className="inline whitespace-pre-wrap">{project.notes}</dd></div> : null}
        </dl>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-bold text-slate-900">Quotations ({data.quotes.length})</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {data.quotes.map((row) => (
              <li key={row.id}><Link href={`/quotes/${row.id}`} className="font-bold underline-offset-2 hover:underline">{row.number}</Link> · {formatDate(row.date)} · {label(row.status)}{row.value !== null ? ` · ${formatCurrency(row.value)}` : ""}</li>
            ))}
            {!data.quotes.length ? <li className="text-slate-500">None linked.</li> : null}
          </ul>
        </section>
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-bold text-slate-900">Orders ({data.orders.length})</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {data.orders.map((row) => (
              <li key={row.id}><Link href={`/orders/${row.id}`} className="font-bold underline-offset-2 hover:underline">{row.number}</Link> · {label(row.stage)} · {formatWeight(row.ordered_kg)}{row.expected_dispatch_date ? ` · due ${formatDate(row.expected_dispatch_date)}` : ""}{row.value !== null ? ` · ${formatCurrency(row.value)}` : ""}</li>
            ))}
            {!data.orders.length ? <li className="text-slate-500">None linked.</li> : null}
          </ul>
        </section>
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-bold text-slate-900">Dispatches ({data.dispatches.length})</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {data.dispatches.map((row) => (
              <li key={row.id}><Link href={`/dispatches/${row.id}`} className="font-bold underline-offset-2 hover:underline">{row.number ?? "Dispatch"}</Link> · {formatDate(row.date)} · {label(row.status)} · {formatWeight(row.weight_kg)}{row.vehicle_number ? ` · ${row.vehicle_number}` : ""}</li>
            ))}
            {!data.dispatches.length ? <li className="text-slate-500">None linked.</li> : null}
          </ul>
        </section>
      </div>

      {canManage ? <ProjectLinkManager projectId={project.id} linkable={project.status === "active" || project.status === "on_hold"} linked={linked} /> : null}

      {data.history.length ? (
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-bold text-slate-900">Recent grouping changes</h2>
          <ul className="mt-2 space-y-1 text-xs text-slate-700">
            {data.history.map((row) => (
              <li key={row.id}>{formatDate(row.created_at)} · {row.actor_name} {row.action} a {ENTITY_LABELS[row.entity_type as ProjectEntity]?.toLowerCase() ?? row.entity_type}{row.reason ? `: ${row.reason}` : ""}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
