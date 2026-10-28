import { nextRecordAction, type NextActionRecord } from "@/lib/workflow/record-next-action";
import type { SessionContext } from "@/types/app";

export function RecordNextAction({ context, record }: { context: SessionContext; record: NextActionRecord }) {
  const action = nextRecordAction(context.role, record, context.dealerId);
  if (!action) return null;
  return <aside className="rounded-2xl border border-orange/25 bg-orange/5 p-4" aria-label="Next action">
    <p className="text-xs font-bold uppercase tracking-wide text-slate-600">Next action</p>
    {action.href ? <a className="mt-1 inline-block font-bold text-slate-950 underline" href={action.href}>{action.label}</a> : <p className="mt-1 font-bold">{action.label}</p>}
    <p className="mt-2 text-sm text-slate-600">{action.reason}</p>
  </aside>;
}
