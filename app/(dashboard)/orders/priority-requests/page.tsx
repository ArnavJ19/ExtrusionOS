import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { PriorityDecision } from "@/components/modules/orchestration/nonconforming-forms";
import { getSessionContext } from "@/lib/auth";
import { priorityAction } from "@/lib/actions/orchestration";
import { canReadOrchestration } from "@/lib/workflow/orchestration";
import { priorityListSchema } from "@/lib/workflow/nonconforming";

const FILTERS = [["pending", "Pending"], ["approved", "Approved"], ["rejected", "Rejected"], ["all", "All"]] as const;
const at = (value: string) => new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export default async function PriorityRequestsPage({ searchParams }: { searchParams: Promise<{ status?: string; page?: string }> }) {
  const [q, context] = await Promise.all([searchParams, getSessionContext()]);
  if (context.dealerId || !canReadOrchestration(context.role)) redirect("/orders");
  const status = (FILTERS.some(([k]) => k === q.status) ? q.status : "pending") as (typeof FILTERS)[number][0];
  const page = Math.min(Math.max(Number.parseInt(q.page ?? "1", 10) || 1, 1), 100000);
  const result = await priorityAction({ command: "list", status, page });
  const list = result.success ? priorityListSchema.safeParse(result.data).data : null;
  const href = (p: number) => `?${new URLSearchParams({ status, page: String(p) })}`;
  return (
    <div className="space-y-5">
      <PageHeader title="Priority change requests" description="Requests to change an order's priority, with the reason and the queue at the time. Production planning authority decides; nobody decides their own request." />
      <nav className="flex flex-wrap gap-2">{FILTERS.map(([k, label]) => <Link key={k} href={`?status=${k}`} className={`rounded-xl border px-3 py-2 text-sm font-bold ${status === k ? "border-orange bg-orange/10" : "bg-white"}`}>{label}</Link>)}</nav>
      {!list ? <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{!result.success ? result.error : "Requests could not be read."}</p>
        : list.rows.length === 0 ? <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">No requests here. Request a change from the order&apos;s lifecycle page.</p> : (
        <ul className="space-y-3">{list.rows.map(r => <li key={r.id} className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-bold uppercase text-slate-500"><Link className="underline" href={`/orders/${r.order_id}/lifecycle`}>{r.order_number}</Link> · {r.from_priority} → {r.to_priority} · {r.status}</p>
          <p className="font-semibold">{r.reason}</p>
          <p className="text-xs text-slate-600">Requested by {r.requested_by_name ?? "—"} {at(r.requested_at)}{r.decided_by_name ? ` · ${r.status} by ${r.decided_by_name}: ${r.decision_note}` : ""}</p>
          {r.impact.length ? <p className="text-xs">Queue at request: {r.impact.map(x => `${x.job_number ?? "job"} on ${x.machine ?? "no press"}${x.queue_rank ? ` rank ${x.queue_rank}` : ""}`).join("; ")}</p> : null}
          <PriorityDecision row={r} />
        </li>)}</ul>
      )}
      {list && list.total > list.page_size ? <nav className="flex justify-between text-sm font-semibold">{page > 1 ? <Link href={href(page - 1)}>Previous</Link> : <span />}<span>Page {page}</span>{page * list.page_size < list.total ? <Link href={href(page + 1)}>Next</Link> : <span />}</nav> : null}
    </div>
  );
}
