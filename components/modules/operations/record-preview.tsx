"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { X } from "lucide-react";
import { getModuleConfig, type ModuleKey } from "./module-config";
import { can } from "@/lib/auth/permissions";
import { buildRecordDetailHref, buildRecordPreviewModel, recordPreviewScope } from "@/lib/workflow/record-preview";
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
};

const focusableSelector = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function displayValue(value: string | number | boolean): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

export function RecordPreview({ open, moduleKey, context, row, returnTo, onClose, triggerRef, loading = false, error = null, rowScope }: RecordPreviewProps) {
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

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open || authorized) return;
    onCloseRef.current();
  }, [open, authorized]);

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
        onCloseRef.current();
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
  }, [effectiveOpen, triggerRef]);

  if (!effectiveOpen || typeof document === "undefined") return null;

  return createPortal(
    <div ref={overlayRef} className="fixed inset-0 z-[100] flex justify-end bg-neutral-950/35" data-record-preview-root onMouseDown={(event) => { if (event.target === event.currentTarget) onCloseRef.current(); }}>
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="record-preview-title"
        tabIndex={-1}
        className="flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-neutral-200 bg-white shadow-2xl outline-none"
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-5 border-b border-neutral-200 bg-white px-5 py-4 sm:px-7">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-neutral-500">{config.title} preview</p>
            <h2 id="record-preview-title" className="mt-1 truncate text-xl font-extrabold text-neutral-950">{model?.title ?? "Record preview"}</h2>
            {model?.subtitle ? <p className="mt-1 truncate text-sm text-neutral-600">{model.subtitle}</p> : null}
          </div>
          <button ref={closeButtonRef} type="button" onClick={() => onCloseRef.current()} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-neutral-200 text-neutral-700 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-800" aria-label="Close record preview">
            <X aria-hidden="true" size={18} />
          </button>
        </header>
        <div className="flex-1 px-5 py-6 sm:px-7">
          {loading || !scopeMatches ? <p role="status" className="rounded-xl bg-neutral-50 p-4 text-sm text-neutral-600">Loading this record…</p> : null}
          {!loading && scopeMatches && error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p> : null}
          {!loading && scopeMatches && !error && !row ? <p role="status" className="rounded-xl bg-neutral-50 p-4 text-sm text-neutral-600">This record is no longer available in the current list.</p> : null}
          {!loading && scopeMatches && !error && row && !model ? <p role="status" className="rounded-xl bg-neutral-50 p-4 text-sm text-neutral-600">A preview is not available for this record type.</p> : null}
          {!loading && scopeMatches && !error && model ? (
            <>
              <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-neutral-500">Quick details</h3>
              {model.fields.length ? <dl className="mt-3 divide-y divide-neutral-100 rounded-2xl border border-neutral-200 px-4">
                {model.fields.map((field) => <div key={field.label} className="grid grid-cols-[minmax(7rem,0.85fr)_minmax(0,1.15fr)] gap-4 py-3">
                  <dt className="text-sm text-neutral-500">{field.label}</dt>
                  <dd className="break-words text-right text-sm font-semibold text-neutral-900">{displayValue(field.value)}</dd>
                </div>)}
              </dl> : <p className="mt-3 rounded-xl bg-neutral-50 p-4 text-sm text-neutral-600">No additional preview details are available from this list row.</p>}
              {detailHref ? <Link href={detailHref} className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl bg-neutral-950 px-4 py-2 text-sm font-bold text-white hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-800 focus-visible:ring-offset-2">Open full record</Link> : <p className="mt-6 text-sm text-neutral-500">Full record link is unavailable from this list.</p>}
            </>
          ) : null}
        </div>
      </section>
    </div>,
    document.body
  );
}
