import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { LiveRefresh } from "@/components/modules/intelligence/live";
import { getSessionContext } from "@/lib/auth";
import { dispatchCommAction } from "@/lib/actions/orchestration";
import { canReadOrchestration } from "@/lib/workflow/orchestration";
import { CHANNEL_LABELS, COMM_STATUS_LABELS, commQueueSchema } from "@/lib/workflow/dispatch-orchestration";

const VIEWS = [["pending", "Customer not yet informed"], ["sent", "Messages recorded"]] as const;
const at = (value: unknown) => (typeof value === "string" ? new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const s = (value: unknown) => (typeof value === "string" && value ? value : "—");

export default async function DispatchCommunicationsPage({ searchParams }: { searchParams: Promise<{ view?: string; page?: string }> }) {
  const [q, context] = await Promise.all([searchParams, getSessionContext()]);
  if (context.dealerId || !canReadOrchestration(context.role)) redirect("/dispatches");
  const view = (VIEWS.some(([k]) => k === q.view) ? q.view : "pending") as (typeof VIEWS)[number][0];
  const page = Math.min(Math.max(Number.parseInt(q.page ?? "1", 10) || 1, 1), 100000);
  const result = await dispatchCommAction({ command: "queue", view, page });
  const list = result.success ? commQueueSchema.safeParse(result.data).data ?? null : null;
  const href = (p: number) => `?${new URLSearchParams({ view, page: String(p) })}`;
  return (
    <div className="space-y-5">
      <PageHeader title="Customer dispatch updates" description="Every dispatch that leaves gets one update to the customer: vehicle, driver, LR, e-way bill, bundles, weight and expected delivery — never rates. Send it from your own WhatsApp, SMS or email and record it here; mark it delivered, read or failed as you see it."
        actions={<div className="flex flex-wrap items-center gap-2"><LiveRefresh name="dispatch-comms" tables={["dispatch_communications", "dispatches"]} /><Link href="/dispatches" className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">Dispatches</Link></div>} />
      <nav className="flex flex-wrap gap-2">{VIEWS.map(([k, label]) => <Link key={k} href={`?view=${k}`} className={`rounded-xl border px-3 py-2 text-sm font-bold ${view === k ? "border-orange bg-orange/10" : "bg-white"}`}>{label}</Link>)}</nav>
      {!list ? <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{!result.success ? result.error : "Messages could not be read."}</p>
        : list.rows.length === 0 ? <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">{view === "pending" ? "Every dispatch of the last 14 days has a recorded customer update." : "No customer messages recorded yet."}</p> : (
        <ul className="space-y-2">{list.rows.map(r => <li key={String(r.id ?? r.dispatch_id)} className="rounded-2xl border border-slate-200 bg-white p-3 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <Link className="font-bold underline" href={`/dispatches/communications/${String(r.dispatch_id)}`}>{s(r.dispatch_number)}</Link>
              <p className="text-xs text-slate-600">Order {s(r.order_number)}{view === "pending" ? ` · ${s(r.customer_name)} · left ${at(r.dispatched_at)} · vehicle ${s(r.vehicle_number)} · LR ${s(r.lr_number)}` : ` · ${CHANNEL_LABELS[String(r.channel)] ?? s(r.channel)} to ${s(r.recipient)} · ${at(r.sent_at)} by ${s(r.sent_by_name)}`}</p>
            </div>
            {view === "sent" ? <span className="rounded-full border px-2 py-0.5 text-xs font-bold">{COMM_STATUS_LABELS[String(r.status)] ?? s(r.status)}</span>
              : Number(r.failed_attempts) > 0 ? <span className="rounded-full border border-red-300 px-2 py-0.5 text-xs font-bold text-red-800">{String(r.failed_attempts)} failed</span> : null}
          </div>
        </li>)}</ul>
      )}
      {list && list.total > list.page_size ? <nav className="flex justify-between text-sm font-semibold">{page > 1 ? <Link href={href(page - 1)}>Previous</Link> : <span />}<span>Page {page}</span>{page * list.page_size < list.total ? <Link href={href(page + 1)}>Next</Link> : <span />}</nav> : null}
    </div>
  );
}
