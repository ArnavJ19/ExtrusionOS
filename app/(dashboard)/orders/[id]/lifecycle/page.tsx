import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { LiveRefresh } from "@/components/modules/intelligence/live";
import { GateChecklist } from "@/components/modules/orchestration/gate-checklist";
import { PriorityRequestForm } from "@/components/modules/orchestration/nonconforming-forms";
import { getSessionContext } from "@/lib/auth";
import { orchestrationAction } from "@/lib/actions/orchestration";
import { formatDate, formatWeight } from "@/lib/utils/format";
import { canReadOrchestration, departmentLabel, lifecycleSchema, overallLabel } from "@/lib/workflow/orchestration";

const at = (value: string | null | undefined) => (value ? new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "—");
const statusText = (value: string) => value.replace(/_/g, " ");
const detailText = (detail: unknown) => {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map(d => d && typeof d === "object" ? `${(d as Record<string, unknown>).die_number ?? ""} (${statusText(String((d as Record<string, unknown>).preparation ?? "no preparation"))})` : String(d)).join(", ") || "—";
  if (detail && typeof detail === "object") return Object.entries(detail as Record<string, unknown>).map(([k, v]) => `${statusText(k)}: ${v}`).join(" · ") || "—";
  return "—";
};

export default async function OrderLifecycleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, context] = await Promise.all([params, getSessionContext()]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  if (context.dealerId || !canReadOrchestration(context.role)) redirect("/orders");
  const result = await orchestrationAction({ command: "lifecycle.order", order_id: id });
  const parsed = result.success ? lifecycleSchema.safeParse(result.data) : null;
  if (!result.success || !parsed?.success) {
    return <div className="space-y-4"><PageHeader title="Order lifecycle" backHref={`/orders/${id}`} backLabel="Back to order" />
      <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{!result.success ? result.error : "The lifecycle could not be read. Refresh to retry."}</p></div>;
  }
  const d = parsed.data;
  const q = d.quantities;
  const ledger: [string, number, string][] = [
    ["Customer ordered", q.ordered_kg, "Order lines"], ["Extruded output", q.produced_kg, "Production runs"], ["Accepted by QC", q.qc_accepted_kg, "QC inspections"],
    ["Awaiting QC disposition", q.qc_pending_kg, "QC inspections"], ["Held in QC containment", q.qc_held_kg ?? 0, "Containments"], ["Rejected by QC", q.qc_rejected_kg, "QC inspections"], ["Packed", q.packed_kg, "Bundles"],
    ["Dispatched", q.dispatched_kg, "Dispatch bundles"], ["Delivered", q.delivered_kg, "Delivery status"], ["Outstanding to dispatch", q.outstanding_kg, "Ordered − dispatched"], ["Reproduction shortfall", q.reproduction_shortfall_kg ?? 0, "Target − accepted, held and planned"]
  ];
  return (
    <div className="space-y-5">
      <PageHeader title={`${d.order.order_number} · ${overallLabel(d.overall)}`} backHref={`/orders/${id}`} backLabel="Back to order"
        description={`${d.order.customer_name ?? "Customer"} · ${d.order.priority ?? "normal"} priority · due ${formatDate(d.order.expected_dispatch_date)} · ${d.order.days_in_stage ?? 0} day(s) in ${statusText(d.order.current_stage)}${d.order.customer_po ? ` · PO ${d.order.customer_po}` : ""}`}
        actions={<div className="flex flex-wrap items-center gap-2"><LiveRefresh name="order-lifecycle" tables={["olo_events", "olo_task_events", "dispatches", "dispatch_communications"]} /><Link href="/orders/lifecycle" className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">Command centre</Link></div>} />

      <section className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Next action</h2>
          {d.next_action ? <><p className="mt-1 text-lg font-bold [overflow-wrap:anywhere]">{d.next_action.label}</p><p className="text-sm">Owner: {departmentLabel(d.next_action.department)}</p>
            {d.next_action.link ? <Link className="mt-2 inline-flex min-h-11 items-center text-sm font-bold underline" href={d.next_action.link}>Go to the work</Link> : null}</> : <p className="mt-1 text-sm">Nothing is pending on this order.</p>}
        </div>
        <div className={`rounded-2xl border p-4 ${d.blocker ? "border-red-200 bg-red-50" : "border-slate-200 bg-white"}`}>
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Blocking progress</h2>
          {d.blocker ? <><p className="mt-1 text-lg font-bold text-red-950 [overflow-wrap:anywhere]">{d.blocker.label}</p><p className="text-sm text-red-900">Resolved by {departmentLabel(d.blocker.department)}</p></> : <p className="mt-1 text-sm">No blocker recorded.</p>}
        </div>
      </section>

      <section aria-label="Domain status" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {d.domains.map(x => <div key={x.key} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3"><p className="text-xs font-bold uppercase text-slate-500">{x.label}</p><p className="font-bold">{statusText(x.status)}</p><p className="text-xs text-slate-600 [overflow-wrap:anywhere]">{detailText(x.detail)}</p></div>)}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-bold">Quantity ledger</h2>
        <p className="text-sm text-slate-600">Each figure is a different physical state from its own record; they are not added together.</p>
        <dl className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">{ledger.map(([label, kg, source]) => <div key={label} className="rounded-xl bg-slate-50 p-3"><dt className="text-xs font-semibold text-slate-600">{label}</dt><dd className="text-lg font-bold">{formatWeight(kg)}</dd><dd className="text-[11px] text-slate-500">{source}</dd></div>)}</dl>
      </section>

      {d.open_tasks.length ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="text-lg font-bold">Open workflow tasks</h2>
          <ul className="mt-2 space-y-2">{d.open_tasks.map(t => <li key={t.id} className="text-sm"><Link className="font-semibold underline" href="/tasks/orchestration?view=all">{t.title}</Link> · {departmentLabel(t.department)} · {t.assignee_name ?? "unassigned"} · due {at(t.due_at)}{t.escalation_level ? ` · escalated (level ${t.escalation_level})` : ""}</li>)}</ul>
        </section>
      ) : null}

      {["owner", "admin", "sales_manager", "sales", "accounts", "production_manager", "factory_manager"].includes(context.role) && !["closed", "cancelled"].includes(d.order.current_stage) ? (
        <section className="space-y-2"><PriorityRequestForm orderId={id} current={d.order.priority} /><Link className="text-sm font-bold underline" href="/orders/priority-requests">Priority requests</Link></section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-bold">Production work orders</h2>
        {d.jobs.length === 0 ? <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">No production jobs exist for this order yet.</p> : d.jobs.map(j => (
          <article key={j.id} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-bold"><Link className="underline" href={`/production/${j.id}`}>{j.job_number ?? "Job"}</Link> · {statusText(j.status)}</h3>
              <p className="text-sm">{j.machine_name ?? "No press"}{j.queue_rank ? ` · queue rank ${j.queue_rank}` : ""}{j.planned_start_at ? ` · starts ${at(j.planned_start_at)}` : ""} · {formatWeight(j.planned_kg)} planned{j.actual_kg ? ` · ${formatWeight(j.actual_kg)} produced` : ""}</p>
            </div>
            {j.gates.length ? <>
              <p className={`mt-2 text-sm font-bold ${j.start_ready ? "text-emerald-800" : "text-red-900"}`}>{j.start_ready ? "Production ready: every gate has passed." : j.planning_ready ? "Planned and resourced; start checks pending." : "Production not ready."}{j.blocker ? ` Blocking reason: ${j.blocker.message ?? j.blocker.label} (${departmentLabel(j.blocker.department)}).` : ""}</p>
              <div className="mt-2"><GateChecklist gates={j.gates} compact /></div></> : null}
          </article>
        ))}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-bold">Lifecycle timeline</h2>
        <p className="text-sm text-slate-600">Most recent first, from the order, finance, queue, production, die, QC, packaging, dispatch, delivery and closure records{d.finance_visible ? "" : "; payment amounts are shown to finance only"}.</p>
        {d.timeline.length ? <ol className="mt-3 space-y-2 border-l border-slate-200 pl-4">{d.timeline.map((e, n) => <li key={`${e.at}-${n}`} className="text-sm"><p className="font-semibold [overflow-wrap:anywhere]">{e.summary}</p><p className="text-xs text-slate-500">{at(e.at)} · {departmentLabel(e.department)}{e.actor_name ? ` · ${e.actor_name}` : ""}</p></li>)}</ol>
          : <p className="mt-2 text-sm">No events recorded yet.</p>}
      </section>
    </div>
  );
}
