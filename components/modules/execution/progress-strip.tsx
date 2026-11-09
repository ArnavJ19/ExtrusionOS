import Link from "next/link";
import { orderProgressAction } from "@/lib/actions/execution";
import { PROGRESS_LABELS, orderProgressSchema, type OrderProgress } from "@/lib/workflow/execution";

const STATE_STYLE: Record<OrderProgress["stages"][number]["state"], string> = {
  complete: "border-emerald-300 bg-emerald-50 text-emerald-950", current: "border-slate-900 bg-slate-900 text-white", blocked: "border-red-400 bg-red-50 text-red-950",
  skipped_by_policy: "border-dashed border-slate-300 bg-white text-slate-500", unavailable: "border-amber-400 bg-amber-50 text-amber-950", upcoming: "border-slate-200 bg-white text-slate-700"
};
const kg = (value: unknown) => Number(value ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 3 });
const when = (value: string) => `${new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium" })}`;

function quantityText(stage: OrderProgress["stages"][number]) {
  const q = stage.quantity; if (!q) return null;
  if ("produced_kg" in q) return `${kg(q.produced_kg)} of ${kg(q.planned_kg)} kg planned, ${String(q.jobs_completed ?? 0)} of ${String(q.jobs ?? 0)} job(s) finished`;
  if ("dispatched_kg" in q) return `${kg(q.dispatched_kg)} kg dispatched of ${kg(q.ordered_kg)} kg ordered`;
  return null;
}

/** NOV-087: read-only progress derived from stage evidence. Following a link never changes the order. */
export function ProgressStripView({ progress }: { progress: OrderProgress }) {
  const current = progress.stages.find(stage => stage.state === "current" || stage.state === "blocked");
  const next = progress.stages.find(stage => stage.state === "upcoming" && stage.applicable);
  return <section aria-label="Order progress" className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="font-bold">Progress</h2>
      <p className="text-xs text-slate-600">{progress.route ? `Route: ${progress.route.name} v${progress.route.version}` : "No approved route bound; showing the standard sequence"}</p>
    </div>
    <p className="text-sm font-semibold" role="status">{progress.cancelled ? "This order was cancelled." : current ? `Now: ${current.label}${current.state === "blocked" ? " (blocked)" : ""}.` : "No current stage is recorded."}{!progress.cancelled && next ? ` Next: ${next.label}.` : ""}</p>
    {progress.blockers.length ? <ul className="list-disc space-y-1 pl-5 text-sm text-red-900">{progress.blockers.map(item => <li key={item}>{item}</li>)}</ul> : null}
    {progress.reopened ? <p className="text-sm text-amber-900">Some work was reopened: the order went back to an earlier stage at least once.</p> : null}
    <div className="-mx-1 overflow-x-auto px-1 pb-2">
      <ol className="flex min-w-max gap-2">{progress.stages.map(stage => {
        const text = quantityText(stage);
        const body = <>
          <span className="block text-xs font-bold">{stage.label}{stage.optional ? " (optional)" : ""}</span>
          <span className="block text-[11px]">{PROGRESS_LABELS[stage.state]}{stage.reopened ? ", reopened" : ""}</span>
          {stage.evidence ? <span className="block text-[11px]">{when(stage.evidence.changed_at)}{stage.evidence.by ? ` · ${stage.evidence.by}` : ""}</span> : null}
          {stage.planned_date ? <span className="block text-[11px]">Planned {when(stage.planned_date)}</span> : null}
          {text ? <span className="block max-w-44 text-[11px]">{text}</span> : null}
          {stage.reason ? <span className="block max-w-44 text-[11px]">{stage.reason}</span> : null}
        </>;
        return <li key={stage.stage} aria-current={stage.state === "current" || stage.state === "blocked" ? "step" : undefined} className={`min-h-16 min-w-32 rounded-xl border p-2 ${STATE_STYLE[stage.state]}`}>
          {stage.href ? <Link href={stage.href} className="block underline-offset-2 hover:underline">{body}</Link> : body}</li>;
      })}</ol>
    </div>
    <p className="text-xs text-slate-600">Each completed stage shows the recorded change behind it. A stage passed without a recorded change is marked as missing evidence, not as complete. Quantities are shown in kilograms, not percentages.</p>
    {Object.keys(progress.errors).length ? <p role="alert" className="text-sm text-amber-900">Some sources could not be read, so the affected stages are shown as unavailable. The order itself is unaffected.</p> : null}
  </section>;
}

export async function OrderProgressStrip({ orderId }: { orderId: string }) {
  const result = await orderProgressAction(orderId);
  const parsed = result.success ? orderProgressSchema.safeParse(result.data) : null;
  if (!parsed?.success) return <section aria-label="Order progress" className="rounded-2xl border border-slate-200 bg-white p-4"><h2 className="font-bold">Progress</h2>
    <p role="alert" className="text-sm font-semibold text-amber-900">{result.success ? "Progress could not be read. The order itself is unaffected." : result.error}</p></section>;
  return <ProgressStripView progress={parsed.data} />;
}
