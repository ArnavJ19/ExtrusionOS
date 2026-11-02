import { nextRecordAction, type NextActionRecord } from "@/lib/workflow/record-next-action";
import type { SessionContext } from "@/types/app";

export function RecordNextAction({ context, record }: { context: SessionContext; record: NextActionRecord }) {
  const action = nextRecordAction(context.role, record, context.dealerId);
  if (!action) return null;
  return <aside className="rounded-2xl border border-orange/25 bg-orange/5 p-4" aria-label="Next action">
    <p className="text-xs font-bold uppercase tracking-wide text-slate-600">Next action</p>
    {action.href ? <a className="mt-1 inline-flex min-h-11 items-center rounded-lg font-bold text-slate-950 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" href={action.href}>{action.label}</a> : <p className="mt-1 font-bold">{action.label}</p>}
    <p className="mt-2 text-sm text-slate-600">{action.reason}</p>
    {action.readiness === "review_required" ? <p className="mt-2 text-xs text-slate-500">Review current evidence at the destination. Availability is checked again when you save.</p> : null}
  </aside>;
}
