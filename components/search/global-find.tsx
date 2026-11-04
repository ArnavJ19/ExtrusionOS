"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { instantFindAction } from "@/lib/actions/instant-search";
import { cleanFindQuery, type FindResponse } from "@/lib/workflow/instant-search";
import { labelize } from "@/types/app";

/** True when a key press is typing into a field, so "/" must not open search. */
export function isTypingTarget(target: EventTarget | null) {
  if (!target || typeof (target as HTMLElement).tagName !== "string") return false;
  const element = target as HTMLElement;
  return element.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName);
}

// NOV-003: find a permitted record from any screen. "/" or Ctrl/Cmd+K opens it; results are the
// server's authorized matches for the latest query only, and actions are rechecked on the target page.
export function GlobalFind({ placeholder }: { placeholder: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<FindResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [active, setActive] = useState(0);
  const [retry, setRetry] = useState(0);
  const version = useRef(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      const shortcut = (event.key === "k" || event.key === "K") && (event.ctrlKey || event.metaKey);
      if (shortcut || (event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey && !isTypingTarget(event.target))) { event.preventDefault(); setOpen(true); }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const returnTo = trigger.current;
    const overlay = dialog.current?.parentElement ?? null;
    const background = Array.from(document.body.children).filter((element): element is HTMLElement => element instanceof HTMLElement && element !== overlay).map(element => ({ element, inert: element.inert }));
    for (const item of background) item.element.inert = true;
    input.current?.focus();
    return () => { for (const item of background) item.element.inert = item.inert; if (returnTo?.isConnected) returnTo.focus(); };
  }, [open]);

  useEffect(() => {
    const current = ++version.current;
    if (!open || query.length > 80 || cleanFindQuery(query).length < 2) return;
    const timer = setTimeout(async () => {
      setPending(true);
      try { const response = await instantFindAction(query); if (version.current === current) { setResult(response); setActive(0); } }
      catch { if (version.current === current) setResult({ query: "", items: [], unavailable: [], error: "Search is unavailable. Retry the lookup." }); }
      finally { if (version.current === current) setPending(false); }
    }, 200);
    return () => { version.current++; clearTimeout(timer); };
  }, [query, open, retry]);

  const valid = query.length <= 80 && cleanFindQuery(query).length >= 2;
  // A response for an earlier query is never shown or opened.
  const current = valid && result?.query === cleanFindQuery(query) ? result : null;
  const items = current?.items ?? [];
  function close() { setOpen(false); setQuery(""); setResult(null); setPending(false); }
  function go(href: string) { close(); router.push(href); }
  function onKeyDown(event: ReactKeyboardEvent) {
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key === "ArrowDown" && items.length) { event.preventDefault(); setActive(index => (index + 1) % items.length); }
    if (event.key === "ArrowUp" && items.length) { event.preventDefault(); setActive(index => (index - 1 + items.length) % items.length); }
    if (event.key === "Enter" && event.target === input.current) {
      event.preventDefault();
      if (items[active]) go(items[active].href); else if (valid) go(`/search?${new URLSearchParams({ q: query.trim() })}`);
    }
    if (event.key === "Tab" && dialog.current) {
      const focusable = Array.from(dialog.current.querySelectorAll<HTMLElement>("a[href],button:not([disabled]),input")).filter(element => element.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }

  return <>
    <button ref={trigger} type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-keyshortcuts="/ Control+K" aria-label="Find a record"
      className="inline-flex h-10 min-w-10 shrink-0 items-center justify-center gap-3 rounded-2xl border border-neutral-200 bg-white px-3 text-sm font-medium text-neutral-500 shadow-sm transition hover:border-neutral-300 hover:text-neutral-800 md:max-w-xl md:flex-1 md:justify-start md:px-4">
      <Search className="h-4 w-4 shrink-0" aria-hidden="true" /><span aria-hidden="true" className="hidden truncate md:inline">{placeholder}</span>
      <span aria-hidden="true" className="ml-auto hidden rounded-md border border-neutral-200 px-1.5 text-[11px] font-semibold text-neutral-400 lg:inline">/</span>
    </button>
    {open && typeof document !== "undefined" ? createPortal(<div className="fixed inset-0 z-[110] flex items-start justify-center bg-neutral-950/40 p-3 pt-[8vh] sm:p-6 sm:pt-[12vh]" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-label="Find a record" onKeyDown={onKeyDown} className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl">
        <div className="flex items-center gap-2 border-b border-neutral-200 p-3">
          <Search className="h-4 w-4 shrink-0 text-neutral-400" aria-hidden="true" />
          <input ref={input} value={query} maxLength={80} autoComplete="off" role="combobox" aria-expanded={items.length > 0} aria-controls={listId} aria-label="Find records"
            aria-activedescendant={items[active] ? `${listId}-${active}` : undefined} className="min-w-0 flex-1 bg-transparent py-2 text-base outline-none"
            placeholder="Order, customer, phone, profile, die or vehicle" onChange={event => { setQuery(event.target.value); setResult(null); setPending(false); }} />
          <button type="button" onClick={close} className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-neutral-600 hover:bg-neutral-100" aria-label="Close search"><X className="h-4 w-4" aria-hidden="true" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <p role="status" aria-live="polite" className="px-1 pb-2 text-sm text-neutral-600">{!valid ? "Type at least 2 letters or digits. Up/Down to move, Enter to open." : pending || (!current && !result?.error) ? "Finding permitted records..." : current ? `${items.length} match(es); at most 6 per record type.` : result?.error}</p>
          {result?.error && valid ? <button type="button" className="px-1 text-sm font-bold underline" onClick={() => setRetry(value => value + 1)}>Retry search</button> : null}
          {current?.unavailable.length ? <p role="alert" className="mb-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Not checked: {current.unavailable.map(labelize).join(", ")}. These are not verified empty results.</p> : null}
          {current && !items.length && !current.unavailable.length ? <p className="rounded-xl bg-neutral-50 p-3 text-sm text-neutral-700">No permitted record matches. Try an order number, profile code, die number, customer name, phone or vehicle number.</p> : null}
          <ul id={listId} role="listbox" aria-label="Matching records" className="space-y-1">{items.map((item, index) => <li key={`${item.resource}:${item.id}`} id={`${listId}-${index}`} role="option" aria-selected={index === active}
            className={`min-w-0 rounded-xl border p-3 ${index === active ? "border-neutral-900 bg-neutral-50" : "border-transparent"}`} onMouseEnter={() => setActive(index)}>
            <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">{labelize(item.resource)} · {labelize(item.status)}</p>
            <Link href={item.href} onClick={close} className="mt-0.5 block break-words font-bold text-neutral-950 underline decoration-neutral-200 underline-offset-4">{item.title}</Link>
            {item.detail ? <p className="break-words text-sm text-neutral-600">{item.detail}</p> : null}
            {item.action ? <Link href={item.action.href} onClick={close} className="mt-1 inline-flex min-h-9 items-center text-sm font-bold text-orange">{item.action.label}</Link> : null}
          </li>)}</ul>
        </div>
        <div className="border-t border-neutral-200 p-3 text-sm"><Link href={valid ? `/search?${new URLSearchParams({ q: query.trim() })}` : "/search"} onClick={close} className="font-bold underline">Open full search results</Link></div>
      </div>
    </div>, document.body) : null}
  </>;
}
