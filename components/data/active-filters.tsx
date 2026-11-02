"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ActiveFilters({ filters, count, loading, onRemove, onClear, onResetSavedView }: {
  filters: { key: string; label: string }[];
  count: number | null;
  loading?: boolean;
  onRemove: (key: string) => void;
  onClear: () => void;
  onResetSavedView?: () => void;
}) {
  return (
    <div className="space-y-2 border-t border-neutral-100 px-4 py-3" aria-label="Current database view">
      <p role="status" className="text-xs font-semibold text-neutral-600">{loading ? "Updating this view..." : count === null ? "Record count unavailable" : `${count.toLocaleString("en-IN")} ${filters.length ? "matching" : "accessible"} record${count === 1 ? "" : "s"}`}. Ten records per page.</p>
      {filters.length ? <div className="flex flex-wrap items-center gap-2" aria-label="Active filters">
        {filters.map((filter) => <button key={filter.key} type="button" className="inline-flex min-h-10 max-w-full items-center gap-2 rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-left text-xs font-semibold text-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange" aria-label={`Remove ${filter.label}`} onClick={() => onRemove(filter.key)}><span className="min-w-0 [overflow-wrap:anywhere]">{filter.label}</span><X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /></button>)}
        <Button type="button" variant="ghost" onClick={onClear}>Clear all filters</Button>
      </div> : null}
      {onResetSavedView ? <Button type="button" variant="secondary" onClick={onResetSavedView}>Reset to saved view</Button> : null}
    </div>
  );
}
