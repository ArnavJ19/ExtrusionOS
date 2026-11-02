"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export type SearchableSelectOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
  disabledReason?: string;
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
  onSearchChange?: (query: string) => void;
  searching?: boolean;
  ariaLabel?: string;
  inputId?: string;
  ariaDescribedBy?: string;
  invalid?: boolean;
  error?: string | null;
  onRetry?: () => void;
};

export function SearchableSelect({ value, options, onChange, placeholder = "Select", disabled, className, emptyText = "No matching options", onSearchChange, searching = false, ariaLabel, inputId, ariaDescribedBy, invalid, error, onRetry }: SearchableSelectProps) {
  const id = useId();
  const listId = `${id}-options`;
  const selected = options.find((option) => option.value === value) ?? null;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(selected?.label ?? "");
  const [querySelection, setQuerySelection] = useState(value);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    if (!open) { setQuery(selected?.label ?? ""); setQuerySelection(value); }
  }, [open, selected?.label, value]);

  useEffect(() => () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
  }, []);

  const visibleQuery = querySelection === value ? query : selected?.label ?? "";
  const search = visibleQuery.trim().toLowerCase();
  const filteredOptions = !search || selected?.label === visibleQuery ? options : options.filter((option) => `${option.label} ${option.description ?? ""} ${option.value}`.toLowerCase().includes(search));

  useEffect(() => { setActiveIndex(-1); }, [options]);

  useEffect(() => {
    if (open && activeIndex >= 0) document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open, listId]);

  function move(direction: 1 | -1) {
    openOptions();
    if (searching || error) return;
    let next = activeIndex < 0 && direction === -1 ? 0 : activeIndex;
    for (let count = 0; count < filteredOptions.length; count++) {
      next = (next + direction + filteredOptions.length) % filteredOptions.length;
      if (!filteredOptions[next]?.disabled) { setActiveIndex(next); return; }
    }
  }

  function cancelClose() {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    blurTimer.current = null;
  }

  function openOptions() {
    if (disabled) return;
    cancelClose();
    setOpen(true);
  }

  function closeSoon() {
    cancelClose();
    blurTimer.current = setTimeout(() => { setOpen(false); blurTimer.current = null; }, 120);
  }

  function choose(option: SearchableSelectOption) {
    if (disabled || searching || error || option.disabled) return;
    cancelClose();
    onChange(option.value);
    setQuery(option.label);
    setQuerySelection(option.value);
    setOpen(false);
    setActiveIndex(-1);
  }

  return (
    <div className={cn("relative", className)} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) closeSoon();
    }}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
        <input
          id={inputId ?? id}
          role="combobox"
          aria-label={ariaLabel ?? placeholder}
          aria-autocomplete="list"
          aria-expanded={open && !disabled}
          aria-controls={open && !disabled ? listId : undefined}
          aria-activedescendant={open && !searching && !error && filteredOptions[activeIndex] ? `${listId}-${activeIndex}` : undefined}
          aria-describedby={[value ? `${id}-selection` : "", ariaDescribedBy].filter(Boolean).join(" ") || undefined}
          aria-invalid={invalid || undefined}
          className="form-input w-full pl-9 pr-16"
          value={visibleQuery}
          placeholder={placeholder}
          disabled={disabled}
          onFocus={() => {
            openOptions();
            setQuery(selected?.label ?? "");
            setQuerySelection(value);
          }}
          onClick={openOptions}
          onChange={(event) => {
            setQuery(event.target.value);
            setQuerySelection(value);
            setOpen(true);
            setActiveIndex(-1);
            onSearchChange?.(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Escape") { event.preventDefault(); setOpen(false); setQuery(selected?.label ?? ""); setQuerySelection(value); setActiveIndex(-1); }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              move(event.key === "ArrowDown" ? 1 : -1);
            }
            if (event.key === "Enter" && open) {
              event.preventDefault();
              const option = activeIndex >= 0 ? filteredOptions[activeIndex] : filteredOptions.find((item) => !item.disabled);
              if (option) choose(option);
            }
          }}
        />
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {value && !disabled ? (
            <button type="button" className="flex h-10 w-10 items-center justify-center rounded-full text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-700" onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(""); setQuery(""); setQuerySelection(""); setOpen(false); }} aria-label="Clear selection">
              <X className="h-4 w-4" />
            </button>
          ) : null}
          <ChevronDown className="h-4 w-4 text-neutral-400" />
        </div>
      </div>
      {value ? <p id={`${id}-selection`} className="mt-1 text-xs font-medium text-neutral-600 [overflow-wrap:anywhere]">{selected ? [selected.label, selected.description, selected.disabledReason].filter(Boolean).join(" | ") : "Selected record details unavailable. Search again or clear this selection."}</p> : null}
      {open && !disabled ? (
        <div className="absolute z-30 mt-2 max-h-64 w-full overflow-y-auto rounded-2xl border border-neutral-200 bg-white p-1 shadow-xl">
          {error ? <div role="alert" className="px-3 py-3 text-sm text-red-800">Lookup unavailable. Your selection is retained.{onRetry ? <button type="button" className="mt-2 block min-h-10 rounded-lg border border-red-200 px-3 font-semibold" onClick={onRetry}>Retry lookup</button> : null}</div> : null}
          <div id={listId} role="listbox" aria-label={`${ariaLabel ?? placeholder} options`} aria-busy={searching || undefined}>
          {error ? null : searching ? <div role="status" className="px-3 py-4 text-sm font-semibold text-neutral-500">Searching...</div> : filteredOptions.length ? filteredOptions.map((option, index) => (
            <div
              id={`${listId}-${index}`}
              role="option"
              aria-label={option.label}
              aria-describedby={option.description || option.disabledReason ? `${listId}-${index}-context` : undefined}
              aria-selected={option.value === value}
              aria-disabled={option.disabled || undefined}
              key={option.value}
              className={cn("block min-h-11 w-full rounded-xl px-3 py-2 text-left text-sm font-semibold text-neutral-700 [overflow-wrap:anywhere]", option.disabled ? "cursor-not-allowed bg-neutral-50 text-neutral-500" : "cursor-pointer hover:bg-orange/10", (index === activeIndex || option.value === value) && "bg-orange/10 ring-1 ring-inset ring-orange/50")}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(option)}
            >
              <span className="block">{option.label}</span>
              {option.description || option.disabledReason ? <span id={`${listId}-${index}-context`} className="mt-0.5 block text-xs font-medium text-neutral-600">{option.description}{option.disabledReason ? <span className="mt-0.5 block font-semibold text-red-800">{option.disabledReason}</span> : null}</span> : null}
            </div>
          )) : <div role="status" className="px-3 py-4 text-sm font-semibold text-neutral-500">{emptyText}</div>}
          </div>
        </div>
      ) : null}
    </div>
  );
}
