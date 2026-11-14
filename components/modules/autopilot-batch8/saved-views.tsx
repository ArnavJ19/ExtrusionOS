"use client";

// AP-092: filters already live in the URL; this saves them as a named view per person and page, one of which can be the
// person's default. Opening the page without filters restores the default view. Views are saved on the server, so they
// follow the person to another computer.
import { useEffect, useRef, useState } from "react";
import { Star, Trash2 } from "lucide-react";
import { clearDefaultViewAction, defaultViewAction, deleteViewAction, listViewsAction, saveViewAction, setDefaultViewAction, type SavedView } from "@/lib/preferences/saved-views-client";

/** On first load without filters in the URL, applies the person's default view for this page (once). */
export function useDefaultView(pageKey: string, hasFilters: boolean, apply: (query: string, name: string) => void) {
  const done = useRef(false);
  const [applied, setApplied] = useState<string | null>(null);
  useEffect(() => {
    if (done.current || hasFilters) { done.current = true; return; }
    done.current = true;
    let live = true;
    void defaultViewAction(pageKey).then(result => {
      if (!live || !result.success || !result.data?.view) return;
      apply(result.data.view.query, result.data.view.name);
      setApplied(result.data.view.name);
    });
    return () => { live = false; };
  }, [pageKey]); // runs once per page: the first URL decides
  return applied;
}

export function SavedViewsMenu({ pageKey, query, onApply, onSaved, appliedDefault }: { pageKey: string; query: string; onApply: (query: string, name: string) => void; onSaved?: (name: string) => void; appliedDefault?: string | null }) {
  const [open, setOpen] = useState(false); const [views, setViews] = useState<SavedView[] | null>(null); const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(""); const [makeDefault, setMakeDefault] = useState(false); const [busy, setBusy] = useState(false); const [note, setNote] = useState<string | null>(null);
  async function load() {
    const result = await listViewsAction(pageKey);
    if (!result.success) { setError(result.error); return; }
    setError(null); setViews(result.data.views);
  }
  useEffect(() => { if (open && !views) void load(); }, [open]);
  const box = useRef<HTMLDivElement | null>(null);
  // Escape or a click outside closes the menu.
  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    const click = (event: MouseEvent) => { if (box.current && !box.current.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("keydown", key); document.addEventListener("mousedown", click);
    return () => { document.removeEventListener("keydown", key); document.removeEventListener("mousedown", click); };
  }, [open]);
  async function act(fn: () => Promise<{ success: boolean; error?: string }>, done: string) {
    setBusy(true); const result = await fn(); setBusy(false);
    if (!result.success) { setError(result.error ?? "The view could not be changed."); return false; }
    setNote(done); await load(); return true;
  }
  return <div ref={box} className="relative">
    <button type="button" aria-expanded={open} aria-controls={`views-${pageKey}`} onClick={() => setOpen(v => !v)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm font-semibold">
      <Star className="h-4 w-4" />My views{appliedDefault ? `: ${appliedDefault}` : ""}</button>
    {open ? <div id={`views-${pageKey}`} className="absolute right-0 z-30 mt-2 w-[22rem] space-y-3 max-sm:fixed max-sm:inset-x-4 max-sm:top-24 max-sm:mt-0 max-sm:max-h-[70vh] max-sm:w-auto max-sm:overflow-y-auto rounded-2xl border border-neutral-200 bg-white p-3 text-sm shadow-lg">
      {error ? <p role="alert" className="rounded-lg bg-amber-50 px-2 py-1 text-amber-900">{error}</p> : null}
      {note ? <p role="status" className="rounded-lg bg-emerald-50 px-2 py-1 text-emerald-800">{note}</p> : null}
      {!views && !error ? <p role="status">Loading your views…</p> : views && !views.length ? <p className="text-neutral-600">No saved views on this page yet.</p> : null}
      {views?.length ? <ul className="divide-y rounded-xl border">{views.map(view => <li key={view.id} className="flex items-center gap-2 p-2">
        <button type="button" className="min-w-0 flex-1 truncate text-left font-semibold underline-offset-2 hover:underline" onClick={() => { onApply(view.query, view.name); setOpen(false); }}>{view.name}{view.is_default ? " (default)" : ""}</button>
        <button type="button" disabled={busy} aria-label={view.is_default ? `Stop using ${view.name} as default` : `Make ${view.name} my default`} title={view.is_default ? "Stop using as default" : "Make my default"}
          onClick={() => void act(() => view.is_default ? clearDefaultViewAction(pageKey) : setDefaultViewAction(view.id), view.is_default ? "No default view now." : `${view.name} opens by default.`)}
          className={`rounded-lg p-1.5 ${view.is_default ? "text-amber-600" : "text-neutral-400"}`}><Star className="h-4 w-4" fill={view.is_default ? "currentColor" : "none"} /></button>
        <button type="button" disabled={busy} aria-label={`Remove ${view.name}`} onClick={() => void act(() => deleteViewAction(view.id), "View removed.")} className="rounded-lg p-1.5 text-neutral-400 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
      </li>)}</ul> : null}
      <form className="space-y-2" onSubmit={async e => {
        e.preventDefault(); if (!name.trim()) return;
        if (await act(() => saveViewAction({ page_key: pageKey, name: name.trim().slice(0, 60), query, make_default: makeDefault }), makeDefault ? `Saved as your default view.` : "View saved.")) { onSaved?.(name.trim()); setName(""); setMakeDefault(false); }
      }}>
        <label className="block text-xs font-bold">Save the current filters as<input aria-label="Saved view name" value={name} onChange={e => setName(e.target.value)} maxLength={60} placeholder="Name this view" className="mt-1 min-h-10 w-full rounded-xl border border-neutral-200 px-3 text-sm" /></label>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={makeDefault} onChange={e => setMakeDefault(e.target.checked)} /> Open this page with it by default</label>
        <button type="submit" disabled={busy || !name.trim()} className="min-h-10 rounded-xl bg-neutral-950 px-3 text-sm font-bold text-white disabled:opacity-50">Save view</button>
      </form>
    </div> : null}
  </div>;
}
