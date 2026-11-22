import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { LiveRefresh } from "@/components/modules/intelligence/live";
import { getSessionContext } from "@/lib/auth";
import { orchestrationAction } from "@/lib/actions/orchestration";
import { formatDate, formatWeight } from "@/lib/utils/format";
import { DEPARTMENTS, RISK_LABELS, boardSchema, canReadOrchestration, departmentLabel, overallLabel, summarySchema, type Department } from "@/lib/workflow/orchestration";

const TILES: { key: string; label: string; href: string; finance?: boolean }[] = [
  { key: "quotes_follow_up_due", label: "Quotations due for follow-up", href: "/quotes" },
  { key: "quotes_accepted_awaiting_order", label: "Accepted quotations awaiting order", href: "/quotes" },
  { key: "orders_awaiting_finance", label: "Orders on credit hold", href: "/orders/credit" },
  { key: "orders_awaiting_planning", label: "Orders awaiting production planning", href: "/production/drafts" },
  { key: "orders_billet_shortage", label: "Orders with billet shortage", href: "/production/material-plan" },
  { key: "jobs_awaiting_die_readiness", label: "Top-of-queue jobs awaiting die readiness", href: "/dies/preparation" },
  { key: "jobs_blocked_by_die_trial", label: "Jobs blocked by die trial", href: "/dies" },
  { key: "jobs_ready", label: "Jobs ready for production", href: "/production/order-book" },
  { key: "jobs_running", label: "Jobs under extrusion", href: "/production" },
  { key: "jobs_awaiting_first_qc", label: "Completed runs awaiting first QC", href: "/quality" },
  { key: "qc_hold_kg", label: "Material awaiting QC disposition (kg)", href: "/quality" },
  { key: "ageing_in_progress", label: "Ageing batches loaded or running", href: "/production/finishing" },
  { key: "ageing_awaiting_review", label: "Ageing batches awaiting release review", href: "/production/finishing" },
  { key: "dispatches_pending", label: "Dispatches awaiting loading", href: "/dispatches" },
  { key: "shipments_in_transit", label: "Shipments in transit", href: "/dispatches" },
  { key: "deliveries_unconfirmed_7_days", label: "Deliveries unconfirmed after 7 days", href: "/dispatches" },
  { key: "orders_partially_fulfilled", label: "Orders partially fulfilled", href: "/orders/lifecycle?stage=active" },
  { key: "orders_financially_outstanding", label: "Orders with outstanding balance", href: "/payments", finance: true },
  { key: "workflow_tasks_overdue", label: "Workflow tasks overdue", href: "/tasks/orchestration?view=overdue" },
  { key: "workflow_tasks_escalated", label: "Workflow tasks escalated", href: "/tasks/orchestration?view=escalated" }
];

export default async function OrderLifecyclePage({ searchParams }: { searchParams: Promise<{ search?: string; department?: string; priority?: string; stage?: string; page?: string }> }) {
  const [q, context] = await Promise.all([searchParams, getSessionContext()]);
  if (context.dealerId || !canReadOrchestration(context.role)) redirect("/orders");
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
  const error = !boardResult.success ? boardResult.error : !board ? "The order board could not be read. Refresh to retry." : null;
  const href = (p: number) => `?${new URLSearchParams({ ...(search ? { search } : {}), ...(department ? { department } : {}), ...(priority ? { priority } : {}), stage, page: String(p) })}`;

  return (
    <div className="space-y-5">
      <PageHeader title="Order lifecycle command centre" description="Where every active order stands, what it needs next, which department owns it and what is blocking it, all derived from the records."
        actions={<><LiveRefresh name="lifecycle-board" tables={["olo_events", "olo_task_events", "dispatches", "orders"]} /><Link href="/tasks/orchestration" className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">Workflow tasks</Link><Link href="/production/order-book" className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">Production order book</Link></>} />
      {summary ? (
        <section aria-label="Live metrics" className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-5">
          {TILES.filter(t => !t.finance || summary.finance_visible).map(t => (
            <Link key={t.key} href={t.href} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3 hover:border-slate-400">
              <p className="text-2xl font-bold">{t.key === "qc_hold_kg" ? formatWeight(Number(summary[t.key] ?? 0)) : String(summary[t.key] ?? "—")}</p>
              <p className="text-xs font-semibold text-slate-600">{t.label}</p>
            </Link>
          ))}
        </section>
      ) : <p role="alert" className="text-sm font-semibold text-amber-900">{summaryResult.success ? "Metrics could not be read." : summaryResult.error}</p>}

      <form className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-3" method="get">
        <label className="text-sm font-semibold">Search<input name="search" defaultValue={search} placeholder="Order number or customer" className="mt-1 block rounded-xl border border-slate-300 px-3 py-2 text-sm" /></label>
        <label className="text-sm font-semibold">Next action owner<select name="department" defaultValue={department ?? ""} className="mt-1 block rounded-xl border border-slate-300 px-3 py-2 text-sm"><option value="">All departments</option>{Object.entries(DEPARTMENTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="text-sm font-semibold">Priority<select name="priority" defaultValue={priority ?? ""} className="mt-1 block rounded-xl border border-slate-300 px-3 py-2 text-sm"><option value="">All</option>{["urgent", "high", "normal", "low"].map(p => <option key={p} value={p}>{p}</option>)}</select></label>
        <label className="text-sm font-semibold">Orders<select name="stage" defaultValue={stage} className="mt-1 block rounded-xl border border-slate-300 px-3 py-2 text-sm"><option value="active">Active</option><option value="all">All, including closed</option></select></label>
        <button className="min-h-11 rounded-xl bg-neutral-950 px-4 text-sm font-bold text-white">Apply</button>
      </form>

      {error ? <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{error}</p> : board && board.rows.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">No orders match these filters.</p>
      ) : board ? (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50"><tr>{["Order", "Customer", "Where it is", "Next action", "Owner", "Blocker", "Days in stage", "Due", "Dispatched / ordered", "Risk"].map(h => <th key={h} scope="col" className="px-3 py-2 font-bold">{h}</th>)}</tr></thead>
            <tbody>
              {board.rows.map(r => (
                <tr key={r.order.id} className="border-t align-top">
                  <td className="px-3 py-2 font-semibold"><Link className="underline" href={`/orders/${r.order.id}/lifecycle`}>{r.order.order_number}</Link><div className="text-xs text-slate-500">{r.order.priority}</div></td>
                  <td className="px-3 py-2">{r.order.customer_name ?? "—"}</td>
                  <td className="px-3 py-2">{overallLabel(r.overall)}</td>
                  <td className="max-w-xs px-3 py-2 [overflow-wrap:anywhere]">{r.next_action ? r.next_action.link ? <Link className="underline" href={r.next_action.link}>{r.next_action.label}</Link> : r.next_action.label : "—"}</td>
                  <td className="px-3 py-2">{departmentLabel(r.next_action?.department)}</td>
                  <td className="max-w-xs px-3 py-2 text-red-900 [overflow-wrap:anywhere]">{r.blocker?.label ?? ""}</td>
                  <td className="px-3 py-2">{r.order.days_in_stage ?? "—"}</td>
                  <td className="px-3 py-2">{formatDate(r.order.expected_dispatch_date)}</td>
                  <td className="px-3 py-2">{formatWeight(r.quantities.dispatched_kg)} / {formatWeight(r.quantities.ordered_kg)}</td>
                  <td className="px-3 py-2"><span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${r.risk === "late" ? "border-red-300 bg-red-50 text-red-900" : r.risk === "at_risk" ? "border-amber-300 bg-amber-50 text-amber-900" : "border-slate-200 text-slate-700"}`}>{RISK_LABELS[r.risk] ?? r.risk}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {board && board.total > board.page_size ? (
        <nav className="flex items-center justify-between text-sm font-semibold" aria-label="Pages">
          {page > 1 ? <Link href={href(page - 1)}>Previous</Link> : <span />}<span>Page {page} of {Math.ceil(board.total / board.page_size)}{board.capped ? " (first 300 orders checked)" : ""}</span>{page * board.page_size < board.total ? <Link href={href(page + 1)}>Next</Link> : <span />}
        </nav>
      ) : null}
    </div>
  );
}
