"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { useWorkAreaOffsets } from "@/lib/hooks/use-work-area-offsets";

export function RecordIdentityStrip({ kind, number, context, status, quantity, unsaved = false }: {
  kind: string; number?: string | null; context?: string | null; status?: string | null; quantity?: ReactNode; unsaved?: boolean;
}) {
  const { ref, top, compactViewport } = useWorkAreaOffsets();
  return <div ref={ref} role="region" aria-label="Current record" className="z-10 flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl border border-neutral-300 bg-white px-4 py-3 shadow-sm" style={{ position: compactViewport ? "relative" : "sticky", top: compactViewport ? undefined : top + 8 }}>
    <div className="min-w-0 flex-1"><p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">{kind} {unsaved ? "- unsaved entries" : "- saved record"}</p><p className="font-bold text-neutral-950 [overflow-wrap:anywhere]">{unsaved ? "New record" : number || "Identity unavailable"}</p>{context ? <p className="line-clamp-2 text-sm font-medium text-neutral-600 [overflow-wrap:anywhere]">{context}</p> : null}</div>
    <div className="flex max-w-full flex-wrap items-center gap-2 text-sm tabular-nums">{status ? <Badge value={status} /> : null}{quantity}</div>
  </div>;
}
