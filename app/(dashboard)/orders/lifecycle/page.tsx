import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { LiveRefresh } from "@/components/modules/intelligence/live";
import { getSessionContext } from "@/lib/auth";
import { orchestrationAction } from "@/lib/actions/orchestration";
import { FloorLanguageToggle } from "@/components/modules/autopilot-batch9/floor-language";
import { floorText, isFloorKey, type FloorKey } from "@/lib/i18n/floor";
import { getFloorLanguage } from "@/lib/i18n/floor-server";
import { formatDate, formatWeight } from "@/lib/utils/format";
import { DEPARTMENTS, RISK_LABELS, boardSchema, canReadOrchestration, departmentLabel, overallLabel, summarySchema, type Department } from "@/lib/workflow/orchestration";

const TILES: { key: string; href: string; finance?: boolean }[] = [
  { key: "quotes_follow_up_due", href: "/quotes" },
  { key: "quotes_accepted_awaiting_order", href: "/quotes" },
  { key: "orders_awaiting_finance", href: "/orders/credit" },
  { key: "orders_awaiting_planning", href: "/production/drafts" },
  { key: "orders_billet_shortage", href: "/production/material-plan" },
  { key: "jobs_awaiting_die_readiness", href: "/dies/preparation" },
  { key: "jobs_blocked_by_die_trial", href: "/dies" },
  { key: "jobs_ready", href: "/production/order-book" },
  { key: "jobs_running", href: "/production" },
  { key: "jobs_awaiting_first_qc", href: "/quality" },
  { key: "qc_hold_kg", href: "/quality" },
  { key: "ageing_in_progress", href: "/production/finishing" },
  { key: "ageing_awaiting_review", href: "/production/finishing" },
  { key: "dispatches_pending", href: "/dispatches" },
  { key: "shipments_in_transit", href: "/dispatches" },
  { key: "deliveries_unconfirmed_7_days", href: "/dispatches" },
  { key: "orders_partially_fulfilled", href: "/orders/lifecycle?stage=active" },
  { key: "orders_financially_outstanding", href: "/payments", finance: true },
  { key: "workflow_tasks_overdue", href: "/tasks/orchestration?view=overdue" },
  { key: "workflow_tasks_escalated", href: "/tasks/orchestration?view=escalated" }
];

export default async function OrderLifecyclePage({ searchParams }: { searchParams: Promise<{ search?: string; department?: string; priority?: string; stage?: string; page?: string }> }) {
  const [q, context, lang] = await Promise.all([searchParams, getSessionContext(), getFloorLanguage()]);
  if (context.dealerId || !canReadOrchestration(context.role)) redirect("/orders");
  const t = floorText(lang);
  const label = (prefix: string, value: string | null | undefined, fallback: string) => (value && isFloorKey(`${prefix}${value}`) ? t(`${prefix}${value}` as FloorKey) : fallback);
  const dept = (d: string | null | undefined) => label("olo.dept.", d, departmentLabel(d));
  const page = Math.min(Math.max(Number.parseInt(q.page ?? "1", 10) || 1, 1), 100000);
  const search = (q.search ?? "").slice(0, 80);
  const department = q.department && q.department in DEPARTMENTS ? (q.department as Department) : undefined;
  const priority = ["low", "normal", "high", "urgent"].includes(q.priority ?? "") ? (q.priority as "low" | "normal" | "high" | "urgent") : undefined;
  const stage = q.stage === "all" ? "all" : "active";
  const [summaryResult, boardResult] = await Promise.all([
    orchestrationAction({ command: "lifecycle.summary" }),
    orchestrationAction({ command: "lifecycle.board", page, ...(search ? { search } : {}), ...(department ? { department } : {}), ...(priority ? { priority } : {}), stage })
  ]);
  const summary = summaryResult.success ? summarySchema.safeParse(summaryResult.data).data : null;
  const board = boardResult.success ? boardSchema.safeParse(boardResult.data).data : null;
  const error = !boardResult.success ? boardResult.error : !board ? t("olo.lc.boardFailed") : null;
  const headers: FloorKey[] = ["olo.lc.h.order", "olo.lc.h.customer", "olo.lc.h.where", "olo.lc.h.next", "olo.lc.h.owner", "olo.lc.h.blocker", "olo.lc.h.days", "olo.lc.h.due", "olo.lc.h.dispatched", "olo.lc.h.risk"];
  const href = (p: number) => `?${new URLSearchParams({ ...(search ? { search } : {}), ...(department ? { department } : {}), ...(priority ? { priority } : {}), stage, page: String(p) })}`;

  return (
    <div className="space-y-5" lang={lang}>
      <PageHeader title={t("olo.lc.title")} description={t("olo.lc.desc")}
        actions={<><LiveRefresh name="lifecycle-board" tables={["olo_events", "olo_task_events", "dispatches", "orders"]} /><FloorLanguageToggle lang={lang} /><Link href="/tasks/orchestration" className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">{t("olo.lc.workflowTasks")}</Link><Link href="/production/order-book" className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">{t("olo.lc.orderBook")}</Link></>} />
      {summary ? (
        <section aria-label="Live metrics" className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-5">
          {TILES.filter(tile => !tile.finance || summary.finance_visible).map(tile => (
            <Link key={tile.key} href={tile.href} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3 hover:border-slate-400">
              <p className="text-2xl font-bold">{tile.key === "qc_hold_kg" ? formatWeight(Number(summary[tile.key] ?? 0)) : String(summary[tile.key] ?? "—")}</p>
              <p className="text-xs font-semibold text-slate-600">{label("olo.lc.tile.", tile.key, tile.key.replace(/_/g, " "))}</p>
            </Link>
          ))}
        </section>
      ) : <p role="alert" className="text-sm font-semibold text-amber-900">{summaryResult.success ? t("olo.lc.metricsFailed") : summaryResult.error}</p>}

      <form className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-3" method="get">
        <label className="text-sm font-semibold">{t("olo.lc.search")}<input name="search" defaultValue={search} placeholder={t("olo.lc.searchHint")} className="mt-1 block rounded-xl border border-slate-300 px-3 py-2 text-sm" /></label>
        <label className="text-sm font-semibold">{t("olo.lc.owner")}<select name="department" defaultValue={department ?? ""} className="mt-1 block rounded-xl border border-slate-300 px-3 py-2 text-sm"><option value="">{t("olo.lc.allDepts")}</option>{Object.keys(DEPARTMENTS).map(k => <option key={k} value={k}>{dept(k)}</option>)}</select></label>
        <label className="text-sm font-semibold">{t("olo.lc.priority")}<select name="priority" defaultValue={priority ?? ""} className="mt-1 block rounded-xl border border-slate-300 px-3 py-2 text-sm"><option value="">{t("olo.lc.all")}</option>{["urgent", "high", "normal", "low"].map(p => <option key={p} value={p}>{label("olo.priority.", p, p)}</option>)}</select></label>
        <label className="text-sm font-semibold">{t("olo.lc.orders")}<select name="stage" defaultValue={stage} className="mt-1 block rounded-xl border border-slate-300 px-3 py-2 text-sm"><option value="active">{t("olo.lc.active")}</option><option value="all">{t("olo.lc.allIncl")}</option></select></label>
        <button className="min-h-11 rounded-xl bg-neutral-950 px-4 text-sm font-bold text-white">{t("olo.lc.apply")}</button>
      </form>

      {error ? <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{error}</p> : board && board.rows.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">{t("olo.lc.empty")}</p>
      ) : board ? (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50"><tr>{headers.map(h => <th key={h} scope="col" className="px-3 py-2 font-bold">{t(h)}</th>)}</tr></thead>
            <tbody>
              {board.rows.map(r => (
                <tr key={r.order.id} className="border-t align-top">
                  <td className="px-3 py-2 font-semibold"><Link className="underline" href={`/orders/${r.order.id}/lifecycle`}>{r.order.order_number}</Link><div className="text-xs text-slate-500">{label("olo.priority.", r.order.priority, r.order.priority ?? "")}</div></td>
                  <td className="px-3 py-2">{r.order.customer_name ?? "—"}</td>
                  <td className="px-3 py-2">{label("olo.lc.overall.", r.overall, overallLabel(r.overall))}</td>
                  <td className="max-w-xs px-3 py-2 [overflow-wrap:anywhere]">{r.next_action ? r.next_action.link ? <Link className="underline" href={r.next_action.link}>{r.next_action.label}</Link> : r.next_action.label : "—"}</td>
                  <td className="px-3 py-2">{dept(r.next_action?.department)}</td>
                  <td className="max-w-xs px-3 py-2 text-red-900 [overflow-wrap:anywhere]">{r.blocker?.label ?? ""}</td>
                  <td className="px-3 py-2">{r.order.days_in_stage ?? "—"}</td>
                  <td className="px-3 py-2">{formatDate(r.order.expected_dispatch_date)}</td>
                  <td className="px-3 py-2">{formatWeight(r.quantities.dispatched_kg)} / {formatWeight(r.quantities.ordered_kg)}</td>
                  <td className="px-3 py-2"><span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${r.risk === "late" ? "border-red-300 bg-red-50 text-red-900" : r.risk === "at_risk" ? "border-amber-300 bg-amber-50 text-amber-900" : "border-slate-200 text-slate-700"}`}>{label("olo.lc.risk.", r.risk, RISK_LABELS[r.risk] ?? r.risk)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {board && board.total > board.page_size ? (
        <nav className="flex items-center justify-between text-sm font-semibold" aria-label="Pages">
          {page > 1 ? <Link href={href(page - 1)}>{t("common.previous")}</Link> : <span />}<span>{t("olo.tasks.pageOf", { n: page, total: Math.ceil(board.total / board.page_size) })}{board.capped ? t("olo.lc.capped") : ""}</span>{page * board.page_size < board.total ? <Link href={href(page + 1)}>{t("common.next")}</Link> : <span />}
        </nav>
      ) : null}
    </div>
  );
}
