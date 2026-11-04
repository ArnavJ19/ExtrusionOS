"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { X } from "lucide-react";
import { getModuleConfig, type ModuleKey } from "./module-config";
import { can } from "@/lib/auth/permissions";
import { buildRecordDetailHref, buildRecordPreviewModel, recordFreshness, recordPreviewAlerts, recordPreviewLinks, recordPreviewScope, type RecordFreshness } from "@/lib/workflow/record-preview";
import { canReadImprovement } from "@/lib/workflow/improvement";
import type { SessionContext } from "@/types/app";

export type RecordPreviewProps = {
  open: boolean;
  moduleKey: ModuleKey;
  context: SessionContext;
  row: Record<string, unknown> | null;
  returnTo: string;
  onClose: () => void;
  triggerRef?: { current: HTMLElement | null };
  loading?: boolean;
  error?: string | null;
  rowScope: string;
  /** Exact company-scoped re-read of the previewed record (NOV-089); absent in static previews. */
  verifyRecord?: (id: string) => Promise<{ found: boolean; updatedAt: string | null }>;
  onRefresh?: () => void;
};

const focusableSelector = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function displayValue(value: string | number | boolean): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

export function RecordPreview({ open, moduleKey, context, row, returnTo, onClose, triggerRef, loading = false, error = null, rowScope, verifyRecord, onRefresh }: RecordPreviewProps) {
  const config = getModuleConfig(moduleKey);
  const authorized = Boolean(context.companyId && context.userId && can(context.role, "read", config.resource));
  const scopeMatches = rowScope === recordPreviewScope(context);
  const effectiveOpen = open && authorized;
  const model = buildRecordPreviewModel(moduleKey, scopeMatches ? row : null);
  const detailHref = scopeMatches && model ? buildRecordDetailHref(config.basePath, returnTo, row?.id) : null;
  const dialogRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const pushedHistory = useRef(false);
  const verification = useRef(0);
  const [freshness, setFreshness] = useState<{ id: string; state: RecordFreshness } | null>(null);
  const rowId = typeof row?.id === "string" ? row.id : null;
  // Close returns through history when the preview added an entry, so Back and Close behave alike.
  const requestClose = useCallback(() => {
    if (pushedHistory.current && typeof window !== "undefined") { try { window.history.back(); return; } catch { /* Close directly below. */ } }
    onCloseRef.current();
  }, []);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open || authorized) return;
    onCloseRef.current();
  }, [open, authorized]);

  // Phone Back closes the preview instead of leaving the list; the list keeps its filters and page.
  useEffect(() => {
    if (!effectiveOpen || typeof window === "undefined") return;
    try { window.history.pushState({ ...(window.history.state ?? {}), recordPreview: true }, ""); pushedHistory.current = true; } catch { pushedHistory.current = false; }
    function onPop() { if (!pushedHistory.current) return; pushedHistory.current = false; onCloseRef.current(); }
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      // Closed without Back or Close (for example a new list query or a session change): the entry is
      // neutralised in place. Navigating back here could land after a newly opened preview and close it.
      if (pushedHistory.current) { pushedHistory.current = false; try { if (window.history.state?.recordPreview) window.history.replaceState({ ...window.history.state, recordPreview: false }, ""); } catch { /* History is a convenience. */ } }
    };
  }, [effectiveOpen]);

  // A fresh exact-id read shows whether the listed record changed or is no longer available. Each
  // switch to another row discards the previous read.
  useEffect(() => {
    const current = ++verification.current;
    if (!effectiveOpen || !scopeMatches || !rowId || !verifyRecord) { setFreshness(null); return; }
    setFreshness({ id: rowId, state: "checking" });
    verifyRecord(rowId).then(result => { if (verification.current === current) setFreshness({ id: rowId, state: recordFreshness(row, result) }); })
      .catch(() => { if (verification.current === current) setFreshness({ id: rowId, state: "unknown" }); });
    return () => { verification.current++; };
    // The row object identity changes on every list refresh; only its id and version matter here.
  }, [effectiveOpen, scopeMatches, rowId, row?.updated_at, verifyRecord]);

  useEffect(() => {
    if (!effectiveOpen || typeof document === "undefined") return;
    const returnFocusTo = triggerRef?.current ?? document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const overlay = overlayRef.current;
    const previousInert = Array.from(document.body.children)
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== overlay)
      .map((element) => ({ element, inert: element.inert }));
    for (const item of previousInert) item.element.inert = true;
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const candidates = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter((element) => element.getClientRects().length > 0);
      if (!candidates.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = candidates[0];
      const last = candidates[candidates.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      for (const item of previousInert) item.element.inert = item.inert;
      document.body.style.overflow = previousOverflow;
      if (returnFocusTo instanceof HTMLElement && returnFocusTo.isConnected) returnFocusTo.focus();
    };
  }, [effectiveOpen, triggerRef, requestClose]);

  if (!effectiveOpen || typeof document === "undefined") return null;
  const state = freshness && freshness.id === rowId ? freshness.state : null;
  const missing = state === "missing";
  const alerts = scopeMatches && !missing ? recordPreviewAlerts(moduleKey, row) : [];
  const links = scopeMatches && !missing && model ? recordPreviewLinks(moduleKey, row, (action, resource) => can(context.role, action, resource), canReadImprovement(context.role, "dies")) : [];

  return createPortal(
    <div ref={overlayRef} className="fixed inset-0 z-[100] flex items-end justify-end bg-neutral-950/35 sm:items-stretch" data-record-preview-root onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="record-preview-title"
        tabIndex={-1}
        className="flex max-h-[88vh] w-full flex-col overflow-y-auto rounded-t-2xl border-t border-neutral-200 bg-white shadow-2xl outline-none sm:h-full sm:max-h-none sm:max-w-xl sm:rounded-none sm:border-l sm:border-t-0"
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-5 border-b border-neutral-200 bg-white px-5 py-4 sm:px-7">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-neutral-500">{config.title} preview</p>
            <h2 id="record-preview-title" className="mt-1 break-words text-xl font-extrabold text-neutral-950">{model?.title ?? "Record preview"}</h2>
            {model?.subtitle ? <p className="mt-1 break-words text-sm text-neutral-600">{model.subtitle}</p> : null}
          </div>
          <button ref={closeButtonRef} type="button" onClick={requestClose} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-neutral-200 text-neutral-700 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-800" aria-label="Close record preview">
            <X aria-hidden="true" size={18} />
          </button>
        </header>
        <div className="flex-1 px-5 py-6 sm:px-7">
          {loading || !scopeMatches ? <p role="status" className="rounded-xl bg-neutral-50 p-4 text-sm text-neutral-600">Loading this record…</p> : null}
          {!loading && scopeMatches && error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p> : null}
          {!loading && scopeMatches && !error && !row ? <p role="status" className="rounded-xl bg-neutral-50 p-4 text-sm text-neutral-600">This record is no longer available in the current list.</p> : null}
          {!loading && scopeMatches && !error && row && !model ? <p role="status" className="rounded-xl bg-neutral-50 p-4 text-sm text-neutral-600">A preview is not available for this record type.</p> : null}
          {!loading && scopeMatches && !error && model && missing ? <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">This record was removed or is no longer available to you. Refresh the list to see current records.
            {onRefresh ? <button type="button" onClick={() => { onRefresh(); requestClose(); }} className="mt-3 block font-bold underline">Refresh the list</button> : null}</p> : null}
          {!loading && scopeMatches && !error && model && !missing ? (
            <>
              {state === "checking" ? <p role="status" className="mb-3 text-xs text-neutral-500">Checking that this record is current…</p> : null}
              {state === "changed" ? <div role="status" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">This record changed after the list loaded. The details below are from the list.
                {onRefresh ? <button type="button" onClick={onRefresh} className="mt-2 block font-bold underline">Refresh the list</button> : null}</div> : null}
              {state === "unknown" && verifyRecord ? <p role="status" className="mb-3 text-xs text-neutral-500">Could not confirm this record is current; the details are from the list.</p> : null}
              {alerts.length ? <ul aria-label="Needs attention" className="mb-4 space-y-2">{alerts.map(alert => <li key={alert.text} className={`rounded-xl border p-3 text-sm font-semibold ${alert.tone === "critical" ? "border-red-200 bg-red-50 text-red-900" : "border-amber-200 bg-amber-50 text-amber-950"}`}>{alert.text}</li>)}</ul> : null}
              <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-neutral-500">Quick details</h3>
              {model.fields.length ? <dl className="mt-3 divide-y divide-neutral-100 rounded-2xl border border-neutral-200 px-4">
                {model.fields.map((field) => <div key={field.label} className="grid grid-cols-[minmax(7rem,0.85fr)_minmax(0,1.15fr)] gap-4 py-3">
                  <dt className="text-sm text-neutral-500">{field.label}</dt>
                  <dd className="break-words text-right text-sm font-semibold text-neutral-900">{displayValue(field.value)}</dd>
                </div>)}
              </dl> : <p className="mt-3 rounded-xl bg-neutral-50 p-4 text-sm text-neutral-600">No additional preview details are available from this list row.</p>}
              {links.length ? <div className="mt-5"><h3 className="text-xs font-bold uppercase tracking-[0.14em] text-neutral-500">Next steps</h3>
                <ul className="mt-2 flex flex-wrap gap-2">{links.map(link => <li key={link.href}><Link href={link.href} className="inline-flex min-h-11 items-center rounded-xl border border-neutral-200 px-3 text-sm font-semibold text-neutral-900 hover:bg-neutral-50">{link.label}</Link></li>)}</ul></div> : null}
              {detailHref ? <Link href={detailHref} className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl bg-neutral-950 px-4 py-2 text-sm font-bold text-white hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-800 focus-visible:ring-offset-2">Open full record</Link> : <p className="mt-6 text-sm text-neutral-500">Full record link is unavailable from this list.</p>}
            </>
          ) : null}
        </div>
      </section>
    </div>,
    document.body
  );
}
