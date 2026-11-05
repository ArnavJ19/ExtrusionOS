export default function ExecutionLoading() {
  return <div role="status" aria-live="polite" className="rounded-2xl border bg-white p-6 text-sm font-semibold text-slate-700">Loading current execution records. No new action is confirmed while this read is pending.</div>;
}
