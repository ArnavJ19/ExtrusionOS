export function LoadingSpinner() {
  return <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-orange" aria-label="Loading" />;
}

export function LoadingState({ title = "Loading", description = "Fetching the latest company data." }: { title?: string; description?: string }) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center rounded-3xl border border-slate-200 bg-gradient-to-br from-white to-aluminium/70 p-8 text-center shadow-inner">
      <LoadingSpinner />
      <p className="mt-4 text-base font-black tracking-tight text-slate-950">{title}</p>
      <p className="mt-1 max-w-md text-sm font-medium text-slate-500">{description}</p>
    </div>
  );
}

export function InlineLoading({ label = "Loading..." }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm font-bold text-slate-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-orange" />
      {label}
    </span>
  );
}
