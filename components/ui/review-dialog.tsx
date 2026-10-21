"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

export function ReviewDialog({ title, onClose, busy = false, children }: { title: string; onClose: () => void; busy?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = ref.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog?.showModal();
    return () => { dialog?.close(); document.body.style.overflow = overflow; trigger?.focus(); };
  }, []);
  return <dialog ref={ref} aria-labelledby={id} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }} onKeyDown={(event) => event.stopPropagation()} className="m-auto max-h-[90vh] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto rounded-3xl border border-neutral-200 bg-white p-5 text-neutral-950 shadow-2xl backdrop:bg-neutral-950/40 sm:p-7"><div className="mb-5 flex items-start justify-between gap-4"><h2 id={id} className="text-xl font-black">{title}</h2><button type="button" onClick={onClose} disabled={busy} className="rounded-lg border px-3 py-2 text-sm font-bold disabled:opacity-50">Back to editing</button></div>{children}</dialog>;
}
