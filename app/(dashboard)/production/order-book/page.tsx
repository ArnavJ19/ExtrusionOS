import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { GateChecklist } from "@/components/modules/orchestration/gate-checklist";
import { EvaluateButton } from "@/components/modules/orchestration/task-actions";
import { getSessionContext } from "@/lib/auth";
import { orchestrationAction } from "@/lib/actions/orchestration";
import { formatDate, formatWeight } from "@/lib/utils/format";
import { canReadOrchestration, departmentLabel, gateTone, isOrchestrationManager, orderBookSchema } from "@/lib/workflow/orchestration";

const at = (value: string) => new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export default async function ProductionOrderBookPage({ searchParams }: { searchParams: Promise<{ press?: string; page?: string }> }) {
  const [q, context] = await Promise.all([searchParams, getSessionContext()]);
  if (context.dealerId || !canReadOrchestration(context.role)) redirect("/production");
  const page = Math.min(Math.max(Number.parseInt(q.page ?? "1", 10) || 1, 1), 100000);
  const press = q.press && /^[0-9a-f-]{36}$/i.test(q.press) ? q.press : undefined;
  const result = await orchestrationAction({ command: "queue.book", page, ...(press ? { machine_id: press } : {}) });
  const parsed = result.success ? orderBookSchema.safeParse(result.data) : null;
  const book = parsed?.success ? parsed.data : null;
  const href = (p: number) => `?${new URLSearchParams({ ...(press ? { press } : {}), page: String(p) })}`;
  return (
    <div className="space-y-5">
      <PageHeader title="Production order book" description="Each press queue in run order, derived from scheduled and released press slots. Rank changes are recorded; jobs entering the top of the queue get billet and die work automatically."
        actions={<>{isOrchestrationManager(context.role) ? <EvaluateButton /> : null}<Link href="/production/schedule" className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">Press schedule</Link></>} />
      {!book ? <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{!result.success ? result.error : "The order book could not be read. Refresh to retry."}</p> : <>
        <p className="text-sm text-slate-700">Billet allocation is requested at rank {book.thresholds.billet} or closer; die preparation at rank {book.thresholds.die} or closer. Priority category and queue rank are separate: the rank changes only when the press schedule changes.</p>
        <nav className="flex flex-wrap gap-2" aria-label="Presses">
          <Link href="?" className={`rounded-xl border px-3 py-2 text-sm font-bold ${!press ? "border-orange bg-orange/10" : "bg-white"}`}>All presses</Link>
          {book.presses.map(p => <Link key={p.id} href={`?press=${p.id}`} className={`rounded-xl border px-3 py-2 text-sm font-bold ${press === p.id ? "border-orange bg-orange/10" : "bg-white"}`}>{p.name} · {p.queued} queued</Link>)}
        </nav>
        {book.rows.length === 0 ? <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">No jobs are scheduled on {press ? "this press" : "any press"}. Schedule released jobs on the press schedule to build the queue.</p> : (
          <div className="space-y-3">
            {book.rows.map(r => {
              const failed = r.gates.filter(g => gateTone(g) === "failed");
              return (
                <article key={r.job_id} className={`rounded-2xl border bg-white p-4 ${r.start_ready ? "border-emerald-300" : failed.length ? "border-red-200" : "border-slate-200"}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-bold uppercase text-slate-500">{r.machine_name} · rank {r.queue_rank} · starts {at(r.planned_start_at)}</p>
                      <h2 className="text-lg font-bold"><Link className="underline" href={`/production/${r.job_id}`}>{r.job_number ?? "Job"}</Link> · {r.order_id ? <Link className="underline" href={`/orders/${r.order_id}/lifecycle`}>{r.order_number}</Link> : "—"} · {r.customer_name ?? "—"}</h2>
                      <p className="text-sm text-slate-700">{r.profile_code ?? "—"} · {r.alloy ?? "—"} {r.temper ?? ""} · billet {r.billet_diameter_inch ?? "—"} in · die {r.die_number ?? "not assigned"} · {formatWeight(r.planned_kg)} · priority {r.priority ?? "normal"} · customer commitment {formatDate(r.customer_commitment_date)}</p>
                    </div>
                    <p className={`rounded-full px-3 py-1 text-xs font-bold ${r.start_ready ? "bg-emerald-100 text-emerald-900" : r.planning_ready ? "bg-sky-100 text-sky-900" : "bg-red-100 text-red-900"}`}>{r.start_ready ? "Ready to start" : r.planning_ready ? "Planned and resourced" : "Not ready"}</p>
                  </div>
                  {r.blocker ? <p className="mt-2 text-sm font-semibold text-red-900">Blocking reason: {r.blocker.message ?? r.blocker.label} — {departmentLabel(r.blocker.department)}</p> : null}
                  <details className="mt-2"><summary className="cursor-pointer text-sm font-bold">All gates ({r.gates.length - failed.length} of {r.gates.length} met)</summary><div className="mt-2"><GateChecklist gates={r.gates} compact /></div></details>
                </article>
              );
            })}
          </div>
        )}
        {book.total > book.page_size ? <nav className="flex justify-between text-sm font-semibold">{page > 1 ? <Link href={href(page - 1)}>Previous</Link> : <span />}<span>Page {page} of {Math.ceil(book.total / book.page_size)}</span>{page * book.page_size < book.total ? <Link href={href(page + 1)}>Next</Link> : <span />}</nav> : null}
        {book.unscheduled.count ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="font-bold">Not on a press schedule ({book.unscheduled.count})</h2>
            <p className="text-sm text-slate-600">These jobs have no queue rank until a press slot is scheduled.</p>
            <ul className="mt-2 space-y-1 text-sm">{book.unscheduled.rows.map(u => <li key={u.job_id}><Link className="underline" href={`/production/${u.job_id}`}>{u.job_number ?? "Job"}</Link> · {u.order_number ?? "—"} · planned {formatDate(u.planned_date)}</li>)}</ul>
          </section>
        ) : null}
      </>}
    </div>
  );
}
