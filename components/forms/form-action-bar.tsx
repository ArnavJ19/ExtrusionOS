"use client";

import type { ReactNode } from "react";
import { useWorkAreaOffsets } from "@/lib/hooks/use-work-area-offsets";

export function FormActionBar({ children, pending, explanation }: { children: ReactNode; pending?: boolean; explanation?: string }) {
  const { ref, bottom, compactViewport } = useWorkAreaOffsets();
  return <div ref={ref} role="group" aria-label="Form actions" aria-busy={pending || undefined} className="z-10 mt-6 space-y-2 rounded-2xl border border-neutral-300 bg-white p-3 shadow-lg" style={{ position: compactViewport ? "relative" : "sticky", bottom: compactViewport ? undefined : `calc(${bottom + 8}px + env(safe-area-inset-bottom, 0px))` }}>
    {explanation ? <p role="status" className="text-xs font-semibold text-neutral-600">{explanation}</p> : null}
    <div className="flex flex-wrap items-center justify-end gap-2 [&_button]:min-h-11 [&_button]:max-w-full [&_button]:whitespace-normal [&_a]:max-w-full">{children}</div>
  </div>;
}
