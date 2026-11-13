"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { orderWithRecent, readRecent, recentStorageKey, rememberRecent } from "@/lib/preferences/recent-values";
import { SCAN_FIELD_EVENT, useRecentScope, type ScanFieldEvent } from "@/components/ui/recent-scope";

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
  /** AP-090: the field's identity for "recently used" values (defaults to the field label); false turns it off. */
  recentKey?: string | false;
  /** AP-025: label types (for example dispatch_package, inventory_batch, die, billet_batch) a USB scanner may fill this
   * field with. An option matches the scanned record by its value or by the ids in its optional `scanIds`. */
  scanAccept?: readonly string[];
};

export function SearchableSelect({ value, options, onChange, placeholder = "Select", disabled, className, emptyText = "No matching options", onSearchChange, searching = false, ariaLabel, inputId, ariaDescribedBy, invalid, error, onRetry, recentKey, scanAccept }: SearchableSelectProps) {
  const id = useId();
  const listId = `${id}-options`;
  const selected = options.find((option) => option.value === value) ?? null;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(selected?.label ?? "");
  const [querySelection, setQuerySelection] = useState(value);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const scope = useRecentScope();
  const storageKey = recentKey === false ? null : recentStorageKey(scope, recentKey ?? ariaLabel ?? placeholder);
  const [recent, setRecent] = useState<string[]>([]);
  const [scanNote, setScanNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { setRecent(readRecent(storageKey)); }, [storageKey]);

  useEffect(() => {
    if (!open) { setQuery(selected?.label ?? ""); setQuerySelection(value); }
  }, [open, selected?.label, value]);

  useEffect(() => () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
  }, []);

  const visibleQuery = querySelection === value ? query : selected?.label ?? "";
  const search = visibleQuery.trim().toLowerCase();
  const browsing = !search || selected?.label === visibleQuery;
  // AP-090: while browsing (nothing typed), the person's last five choices that are still offered come first.
  const ordered = browsing ? orderWithRecent(options, recent) : null;
  const filteredOptions = ordered ? [...ordered.recent, ...ordered.rest] : options.filter((option) => `${option.label} ${option.description ?? ""} ${option.value}`.toLowerCase().includes(search));
  const recentCount = ordered?.recent.length ?? 0;

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
    setRecent(rememberRecent(storageKey, option.value));
    setQuery(option.label);
    setQuerySelection(option.value);
    setOpen(false);
    setActiveIndex(-1);
  }

  // AP-025: the app-wide scanner listener resolves a scanned label on the server and hands the record to this field.
  const chooseRef = useRef(choose);
  const optionsRef = useRef(options);
  useEffect(() => { chooseRef.current = choose; optionsRef.current = options; });
  const acceptKey = scanAccept?.join(",") ?? "";
  useEffect(() => {
    const input = inputRef.current;
    if (!input || !acceptKey) return;
    const accepted = acceptKey.split(",");
    const onScan = (event: Event) => {
      const detail = (event as CustomEvent<ScanFieldEvent>).detail;
      setQuery(selected?.label ?? ""); setQuerySelection(value); setOpen(false);
      if (!detail.ok) { setScanNote({ tone: "error", text: detail.error }); return; }
      if (!accepted.includes(detail.entityType)) { setScanNote({ tone: "error", text: `${detail.label} is not a label this field accepts.` }); return; }
      const match = optionsRef.current.find((option) => option.value === detail.entityId || (Array.isArray(option.scanIds) && (option.scanIds as unknown[]).includes(detail.entityId)));
      if (!match) { setScanNote({ tone: "error", text: `${detail.label} is not one of the choices in this list.` }); return; }
      if (match.disabled) { setScanNote({ tone: "error", text: `${detail.label} cannot be chosen: ${match.disabledReason ?? "it is not available"}.` }); return; }
      chooseRef.current(match);
      setScanNote({ tone: "ok", text: `Scanned ${detail.label}.` });
    };
    input.addEventListener(SCAN_FIELD_EVENT, onScan);
    return () => input.removeEventListener(SCAN_FIELD_EVENT, onScan);
  }, [acceptKey, selected?.label, value]);

  return (
    <div className={cn("relative", className)} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) closeSoon();
    }}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
        <input
          ref={inputRef}
          id={inputId ?? id}
          data-scan-accept={acceptKey || undefined}
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
            setScanNote(null);
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
      {scanNote ? <p role={scanNote.tone === "error" ? "alert" : "status"} className={cn("mt-1 text-xs font-semibold", scanNote.tone === "error" ? "text-red-800" : "text-emerald-800")}>{scanNote.text}</p> : null}
      {value ? <p id={`${id}-selection`} className="mt-1 text-xs font-medium text-neutral-600 [overflow-wrap:anywhere]">{selected ? [selected.label, selected.description, selected.disabledReason].filter(Boolean).join(" | ") : "Selected record details unavailable. Search again or clear this selection."}</p> : null}
      {open && !disabled ? (
        <div className="absolute z-30 mt-2 max-h-64 w-full overflow-y-auto rounded-2xl border border-neutral-200 bg-white p-1 shadow-xl">
          {error ? <div role="alert" className="px-3 py-3 text-sm text-red-800">Lookup unavailable. Your selection is retained.{onRetry ? <button type="button" className="mt-2 block min-h-10 rounded-lg border border-red-200 px-3 font-semibold" onClick={onRetry}>Retry lookup</button> : null}</div> : null}
          <div id={listId} role="listbox" aria-label={`${ariaLabel ?? placeholder} options`} aria-busy={searching || undefined}>
          {error ? null : searching ? <div role="status" className="px-3 py-4 text-sm font-semibold text-neutral-500">Searching...</div> : filteredOptions.length ? filteredOptions.map((option, index) => (
            <div key={option.value} role="none">
              {recentCount && (index === 0 || index === recentCount) ? <div role="presentation" className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wider text-neutral-400">{index === 0 ? "Recently used" : "All"}</div> : null}
              <div
                id={`${listId}-${index}`}
                role="option"
                aria-label={option.label}
                aria-describedby={option.description || option.disabledReason ? `${listId}-${index}-context` : undefined}
                aria-selected={option.value === value}
                aria-disabled={option.disabled || undefined}
                className={cn("block min-h-11 w-full rounded-xl px-3 py-2 text-left text-sm font-semibold text-neutral-700 [overflow-wrap:anywhere]", option.disabled ? "cursor-not-allowed bg-neutral-50 text-neutral-500" : "cursor-pointer hover:bg-orange/10", (index === activeIndex || option.value === value) && "bg-orange/10 ring-1 ring-inset ring-orange/50")}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
              >
                <span className="block">{option.label}</span>
                {option.description || option.disabledReason ? <span id={`${listId}-${index}-context`} className="mt-0.5 block text-xs font-medium text-neutral-600">{option.description}{option.disabledReason ? <span className="mt-0.5 block font-semibold text-red-800">{option.disabledReason}</span> : null}</span> : null}
              </div>
            </div>
          )) : <div role="status" className="px-3 py-4 text-sm font-semibold text-neutral-500">{emptyText}</div>}
          </div>
        </div>
      ) : null}
    </div>
  );
}
