"use client";

import type { ReactNode } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";

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
        <input className="form-input w-full pl-9 pr-10" placeholder={searchPlaceholder} value={search} onChange={(event) => onSearchChange(event.target.value)} />
        {search ? <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-950" onClick={() => onSearchChange("")}><X className="h-4 w-4" /></button> : null}
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

export function DateRangeFilter({ from, to, onFromChange, onToChange }: { from: string; to: string; onFromChange: (value: string) => void; onToChange: (value: string) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <input className="form-input" type="date" aria-label="From date" value={from} onChange={(event) => onFromChange(event.target.value)} />
      <input className="form-input" type="date" aria-label="To date" value={to} onChange={(event) => onToChange(event.target.value)} />
    </div>
  );
}

export function ClearFiltersButton({ onClick }: { onClick: () => void }) {
  return <Button type="button" variant="ghost" onClick={onClick}>Clear</Button>;
}
