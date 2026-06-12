"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export type SearchableSelectOption = {
  value: string;
  label: string;
  [key: string]: unknown;
};

type SearchableSelectProps = {
  value: string;
  options: SearchableSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  emptyText?: string;
};

export function SearchableSelect({ value, options, onChange, placeholder = "Select", disabled, className, emptyText = "No matching options" }: SearchableSelectProps) {
  const selected = options.find((option) => option.value === value) ?? null;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(selected?.label ?? "");
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) setQuery(selected?.label ?? "");
  }, [open, selected?.label]);

  const filteredOptions = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search || selected?.label === query) return options;
    return options.filter((option) => option.label.toLowerCase().includes(search) || String(option.value).toLowerCase().includes(search));
  }, [options, query, selected?.label]);

  function closeSoon() {
    blurTimer.current = setTimeout(() => setOpen(false), 120);
  }

  function choose(option: SearchableSelectOption) {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    onChange(option.value);
    setQuery(option.label);
    setOpen(false);
  }

  return (
    <div className={cn("relative", className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
        <input
          className="form-input w-full pl-9 pr-16"
          value={query}
          placeholder={placeholder}
          disabled={disabled}
          onFocus={() => {
            if (blurTimer.current) clearTimeout(blurTimer.current);
            setOpen(true);
            setQuery(selected?.label ?? "");
          }}
          onBlur={closeSoon}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
            if (event.key === "Enter" && open && filteredOptions[0]) {
              event.preventDefault();
              choose(filteredOptions[0]);
            }
          }}
        />
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {value && !disabled ? (
            <button type="button" className="rounded-full p-1 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700" onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(""); setQuery(""); setOpen(false); }} aria-label="Clear selection">
              <X className="h-4 w-4" />
            </button>
          ) : null}
          <ChevronDown className="h-4 w-4 text-neutral-400" />
        </div>
      </div>
      {open && !disabled ? (
        <div className="absolute z-30 mt-2 max-h-64 w-full overflow-y-auto rounded-2xl border border-neutral-200 bg-white p-1 shadow-xl">
          {filteredOptions.length ? filteredOptions.map((option) => (
            <button
              type="button"
              key={option.value}
              className={cn("block w-full rounded-xl px-3 py-2 text-left text-sm font-semibold text-neutral-700 transition hover:bg-orange/10 hover:text-neutral-950", option.value === value && "bg-orange/10 text-neutral-950")}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(option)}
            >
              {option.label}
            </button>
          )) : <div className="px-3 py-4 text-sm font-semibold text-neutral-500">{emptyText}</div>}
        </div>
      ) : null}
    </div>
  );
}
