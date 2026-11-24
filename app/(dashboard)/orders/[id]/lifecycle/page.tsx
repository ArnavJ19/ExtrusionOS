import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { LiveRefresh } from "@/components/modules/intelligence/live";
import { GateChecklist } from "@/components/modules/orchestration/gate-checklist";
import { PriorityRequestForm } from "@/components/modules/orchestration/nonconforming-forms";
import { getSessionContext } from "@/lib/auth";
import { orchestrationAction } from "@/lib/actions/orchestration";
import { FloorLanguageToggle } from "@/components/modules/autopilot-batch9/floor-language";
import { floorText, isFloorKey, type FloorKey } from "@/lib/i18n/floor";
import { getFloorLanguage } from "@/lib/i18n/floor-server";
import { formatDate, formatWeight } from "@/lib/utils/format";
import { canReadOrchestration, departmentLabel, lifecycleSchema, overallLabel } from "@/lib/workflow/orchestration";
import { qualityFlowSchema } from "@/lib/workflow/final-qc";

const at = (value: string | null | undefined) => (value ? new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "—");
const statusText = (value: string) => value.replace(/_/g, " ");
const detailText = (detail: unknown) => {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map(d => d && typeof d === "object" ? `${(d as Record<string, unknown>).die_number ?? ""} (${statusText(String((d as Record<string, unknown>).preparation ?? "no preparation"))})` : String(d)).join(", ") || "—";
  if (detail && typeof detail === "object") return Object.entries(detail as Record<string, unknown>).map(([k, v]) => `${statusText(k)}: ${v}`).join(" · ") || "—";
  return "—";
};

export default async function OrderLifecycleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, context, lang] = await Promise.all([params, getSessionContext(), getFloorLanguage()]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  if (context.dealerId || !canReadOrchestration(context.role)) redirect("/orders");
  const t = floorText(lang);
  const label = (prefix: string, value: string | null | undefined, fallback: string) => (value && isFloorKey(`${prefix}${value}`) ? t(`${prefix}${value}` as FloorKey) : fallback);
  const dept = (d: string | null | undefined) => label("olo.dept.", d, departmentLabel(d));
  const result = await orchestrationAction({ command: "lifecycle.order", order_id: id });
  const parsed = result.success ? lifecycleSchema.safeParse(result.data) : null;
  if (!result.success || !parsed?.success) {
    return <div className="space-y-4" lang={lang}><PageHeader title={t("olo.lc.detailTitle")} backHref={`/orders/${id}`} backLabel={t("olo.lc.backOrder")} />
      <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{!result.success ? result.error : t("olo.lc.readFailed")}</p></div>;
  }
  const d = parsed.data;
  const q = d.quantities;
  const ledger: [FloorKey, number, FloorKey][] = [
    ["olo.lc.l.ordered", q.ordered_kg, "olo.lc.s.lines"], ["olo.lc.l.produced", q.produced_kg, "olo.lc.s.runs"], ["olo.lc.l.accepted", q.qc_accepted_kg, "olo.lc.s.qc"],
    ["olo.lc.l.pending", q.qc_pending_kg, "olo.lc.s.qc"], ["olo.lc.l.held", q.qc_held_kg ?? 0, "olo.lc.s.containments"], ["olo.lc.l.rejected", q.qc_rejected_kg, "olo.lc.s.qc"], ["olo.lc.l.packed", q.packed_kg, "olo.lc.s.bundles"],
    ["olo.lc.l.dispatched", q.dispatched_kg, "olo.lc.s.dispatchBundles"], ["olo.lc.l.delivered", q.delivered_kg, "olo.lc.s.delivery"], ["olo.lc.l.outstanding", q.outstanding_kg, "olo.lc.s.outstanding"], ["olo.lc.l.repro", q.reproduction_shortfall_kg ?? 0, "olo.lc.s.repro"]
  ];
  // Phase 5: shown once the database reports them and the order has ageing material.
  if (q.final_released_kg !== undefined && (q.awaiting_ageing_kg || q.in_ageing_kg || q.awaiting_final_qc_kg || q.final_released_kg)) {
    ledger.splice(3, 0, ["olo.lc.l.awaitingAgeing", q.awaiting_ageing_kg ?? 0, "olo.lc.s.ageing"], ["olo.lc.l.inAgeing", q.in_ageing_kg ?? 0, "olo.lc.s.treatment"],
      ["olo.lc.l.awaitingFinal", q.awaiting_final_qc_kg ?? 0, "olo.lc.s.treatment"], ["olo.lc.l.finalReleased", q.final_released_kg ?? 0, "olo.lc.s.finalQc"]);
  }
  const flowOf = (job: Record<string, unknown>) => {
    const parsed = qualityFlowSchema.safeParse(job.quality_flow);
    return parsed.success ? parsed.data : null;
  };
  return (
    <div className="space-y-5" lang={lang}>
      <PageHeader title={`${d.order.order_number} · ${label("olo.lc.overall.", d.overall, overallLabel(d.overall))}`} backHref={`/orders/${id}`} backLabel={t("olo.lc.backOrder")}
        description={t("olo.lc.summary", { customer: d.order.customer_name ?? t("olo.lc.customer"), priority: label("olo.priority.", d.order.priority ?? "normal", d.order.priority ?? "normal"), due: formatDate(d.order.expected_dispatch_date),
          days: d.order.days_in_stage ?? 0, stage: statusText(d.order.current_stage) }) + (d.order.customer_po ? t("olo.lc.po", { po: d.order.customer_po }) : "")}
        actions={<div className="flex flex-wrap items-center gap-2"><LiveRefresh name="order-lifecycle" tables={["olo_events", "olo_task_events", "dispatches", "dispatch_communications", "quality_reversals", "final_qc_records"]} /><FloorLanguageToggle lang={lang} /><Link href="/orders/lifecycle" className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">{t("olo.lc.commandCentre")}</Link></div>} />

      <section className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">{t("olo.lc.next")}</h2>
          {d.next_action ? <><p className="mt-1 text-lg font-bold [overflow-wrap:anywhere]">{d.next_action.label}</p><p className="text-sm">{t("olo.lc.ownerLabel", { dept: dept(d.next_action.department) })}</p>
            {d.next_action.link ? <Link className="mt-2 inline-flex min-h-11 items-center text-sm font-bold underline" href={d.next_action.link}>{t("olo.lc.goWork")}</Link> : null}</> : <p className="mt-1 text-sm">{t("olo.lc.nothingPending")}</p>}
        </div>
        <div className={`rounded-2xl border p-4 ${d.blocker ? "border-red-200 bg-red-50" : "border-slate-200 bg-white"}`}>
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">{t("olo.lc.blocking")}</h2>
          {d.blocker ? <><p className="mt-1 text-lg font-bold text-red-950 [overflow-wrap:anywhere]">{d.blocker.label}</p><p className="text-sm text-red-900">{t("olo.lc.resolvedBy", { dept: dept(d.blocker.department) })}</p></> : <p className="mt-1 text-sm">{t("olo.lc.noBlocker")}</p>}
        </div>
      </section>

      <section aria-label="Domain status" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {d.domains.map(x => <div key={x.key} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3"><p className="text-xs font-bold uppercase text-slate-500">{x.label}</p><p className="font-bold">{statusText(x.status)}</p><p className="text-xs text-slate-600 [overflow-wrap:anywhere]">{detailText(x.detail)}</p></div>)}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-bold">{t("olo.lc.ledger")}</h2>
        <p className="text-sm text-slate-600">{t("olo.lc.ledgerHelp")}</p>
        <dl className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">{ledger.map(([key, kg, source]) => <div key={key} className="rounded-xl bg-slate-50 p-3"><dt className="text-xs font-semibold text-slate-600">{t(key)}</dt><dd className="text-lg font-bold">{formatWeight(kg)}</dd><dd className="text-[11px] text-slate-500">{t(source)}</dd></div>)}</dl>
      </section>

      {d.open_tasks.length ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="text-lg font-bold">{t("olo.lc.openTasks")}</h2>
          <ul className="mt-2 space-y-2">{d.open_tasks.map(task => <li key={task.id} className="text-sm"><Link className="font-semibold underline" href="/tasks/orchestration?view=all">{task.title}</Link> · {t("olo.lc.taskLine", { dept: dept(task.department), assignee: task.assignee_name ?? t("olo.tasks.unassigned"), at: at(task.due_at) })}{task.escalation_level ? t("olo.lc.escalated", { n: task.escalation_level }) : ""}</li>)}</ul>
        </section>
      ) : null}

      {["owner", "admin", "sales_manager", "sales", "accounts", "production_manager", "factory_manager"].includes(context.role) && !["closed", "cancelled"].includes(d.order.current_stage) ? (
        <section className="space-y-2"><PriorityRequestForm orderId={id} current={d.order.priority} lang={lang} /><Link className="text-sm font-bold underline" href="/orders/priority-requests">{t("olo.lc.priorityRequests")}</Link></section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-bold">{t("olo.lc.jobs")}</h2>
        {d.jobs.length === 0 ? <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">{t("olo.lc.noJobs")}</p> : d.jobs.map(j => (
          <article key={j.id} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-bold"><Link className="underline" href={`/production/${j.id}`}>{j.job_number ?? t("olo.lc.job")}</Link> · {statusText(j.status)}</h3>
              <p className="text-sm">{j.machine_name ?? t("olo.lc.noPress")}{j.queue_rank ? t("olo.lc.queueRank", { n: j.queue_rank }) : ""}{j.planned_start_at ? t("olo.lc.starts", { at: at(j.planned_start_at) }) : ""}{t("olo.lc.planned", { kg: formatWeight(j.planned_kg) })}{j.actual_kg ? t("olo.lc.produced", { kg: formatWeight(j.actual_kg) }) : ""}</p>
            </div>
            {(() => {
              const flow = flowOf(j);
              if (!flow || flow.produced_kg <= 0) return null;
              return <p className="mt-1 text-sm">{t("fqc.lc.jobLine", { stage: label("fqc.stage.", flow.stage, flow.stage), route: label("fqc.route.", flow.route.state, flow.route.state) })}
                {flow.route.state === "required" ? <> · <Link className="font-semibold underline" href={`/quality/final-qc/${j.id}`}>{t("fqc.lc.openFinal")}</Link></> : null}</p>;
            })()}
            {j.gates.length ? <>
              <p className={`mt-2 text-sm font-bold ${j.start_ready ? "text-emerald-800" : "text-red-900"}`}>{t(j.start_ready ? "olo.lc.startReady" : j.planning_ready ? "olo.lc.planningReady" : "olo.lc.notReady")}{j.blocker ? t("olo.lc.blockingReason", { reason: j.blocker.message ?? j.blocker.label, dept: dept(j.blocker.department) }) : ""}</p>
              <div className="mt-2"><GateChecklist gates={j.gates} compact /></div></> : null}
          </article>
        ))}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-bold">{t("olo.lc.timeline")}</h2>
        <p className="text-sm text-slate-600">{t("olo.lc.timelineHelp")}{d.finance_visible ? "" : t("olo.lc.financeOnly")}</p>
        {d.timeline.length ? <ol className="mt-3 space-y-2 border-l border-slate-200 pl-4">{d.timeline.map((e, n) => <li key={`${e.at}-${n}`} className="text-sm"><p className="font-semibold [overflow-wrap:anywhere]">{e.summary}</p><p className="text-xs text-slate-500">{at(e.at)} · {dept(e.department)}{e.actor_name ? ` · ${e.actor_name}` : ""}</p></li>)}</ol>
          : <p className="mt-2 text-sm">{t("olo.lc.noEvents")}</p>}
      </section>
    </div>
  );
}
