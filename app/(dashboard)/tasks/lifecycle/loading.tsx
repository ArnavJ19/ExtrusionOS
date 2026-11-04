export default function LifecycleLoading() {
  return <div role="status" aria-live="polite" className="rounded-2xl border bg-white p-6 text-sm font-semibold text-slate-700">Loading current order lifecycle records. No new action is confirmed while this read is pending.</div>;
}
