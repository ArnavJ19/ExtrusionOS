"use client";

import type { ReactNode } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DATE_PRESETS, activePreset, presetRange } from "@/lib/utils/date-ranges";

type DataTableToolbarProps = {
  search: string;
  searchPlaceholder: string;
  onSearchChange: (value: string) => void;
  filters?: ReactNode;
  actions?: ReactNode;
};

export function DataTableToolbar({ search, searchPlaceholder, onSearchChange, filters, actions }: DataTableToolbarProps) {
  return (
    <div className="flex flex-col gap-3 border-b border-neutral-100 p-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="relative w-full lg:max-w-xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
        <input aria-label="Search database" maxLength={100} className="form-input w-full pl-9 pr-12" placeholder={searchPlaceholder} value={search} onChange={(event) => onSearchChange(event.target.value.slice(0, 100))} />
        {search ? <button type="button" aria-label="Clear database search" className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-neutral-500 hover:text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange" onClick={() => onSearchChange("")}><X className="h-4 w-4" /></button> : null}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
        {filters}
        {actions}
      </div>
    </div>
  );
}

export function StatusFilter({ value, options, onChange, label = "Status" }: { value: string; options: { label: string; value: string }[]; onChange: (value: string) => void; label?: string }) {
  return (
    <select className="form-input min-w-40" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">All {label.toLowerCase()}</option>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  );
}

/** AP-086: one shared date-range filter with chips (IST days, Monday weeks, April financial year) above the two dates. */
export function DateRangeFilter({ from, to, onFromChange, onToChange, onRangeChange, fromLabel = "From date", toLabel = "To date", className, clearable = true }: { from: string; to: string; onFromChange: (value: string) => void; onToChange: (value: string) => void; onRangeChange?: (from: string, to: string) => void; fromLabel?: string; toLabel?: string; className?: string; clearable?: boolean }) {
  const active = activePreset({ from, to });
  const apply = (range: { from: string; to: string }) => {
    if (onRangeChange) onRangeChange(range.from, range.to);
    else { onFromChange(range.from); onToChange(range.to); }
  };
  return (
    <div className={`min-w-0 space-y-2 ${className ?? ""}`}>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Date range shortcuts">
        {DATE_PRESETS.map((preset) => (
          <button key={preset.key} type="button" aria-pressed={active === preset.key}
            className={`min-h-9 rounded-full border px-3 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange ${active === preset.key ? "border-neutral-950 bg-neutral-950 text-white" : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-400"}`}
            onClick={() => apply(active === preset.key && clearable ? { from: "", to: "" } : presetRange(preset.key))}>{preset.label}</button>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <input className="form-input" type="date" aria-label={fromLabel} value={from} onChange={(event) => onFromChange(event.target.value)} />
        <input className="form-input" type="date" aria-label={toLabel} value={to} onChange={(event) => onToChange(event.target.value)} />
      </div>
    </div>
  );
}

export function ClearFiltersButton({ onClick }: { onClick: () => void }) {
  return <Button type="button" variant="ghost" onClick={onClick}>Clear</Button>;
}
