"use client";

import { useState, type ReactNode, type DragEvent } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { labelize } from "@/types/app";
import { NumberTicker } from "@/components/ui/number-ticker";
import { ViewMoreButton } from "./view-more-button";

type StatusColumnProps = {
  status: string;
  count: number;
  emptyText: string;
  viewMoreHref?: string;
  defaultExpanded?: boolean;
  children: ReactNode;
  /** Drop zone handlers — present only when drag-drop is enabled */
  onDragOver?: (e: DragEvent) => void;
  onDragLeave?: (e: DragEvent) => void;
  onDrop?: (e: DragEvent) => void;
  isDragTarget?: boolean;
};

export function StatusColumn({ status, count, emptyText, viewMoreHref, defaultExpanded = true, children, onDragOver, onDragLeave, onDrop, isDragTarget }: StatusColumnProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <section
      className={`rounded-[20px] border p-3 transition-colors ${isDragTarget ? "border-violet-300 bg-violet-50" : "border-neutral-200 bg-neutral-50/70"}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="mb-1 flex w-full items-center justify-between gap-3 rounded-xl px-1 py-1.5 text-left transition hover:bg-white"
      >
        <div className="flex items-center gap-2">
          {expanded
            ? <ChevronDown className="h-4 w-4 shrink-0 text-neutral-400" />
            : <ChevronRight className="h-4 w-4 shrink-0 text-neutral-400" />
          }
          <h3 className="text-sm font-bold text-neutral-950">{labelize(status)}</h3>
        </div>
        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-neutral-500 ring-1 ring-neutral-200"><NumberTicker value={count} duration={600} /></span>
      </button>
      {expanded ? (
        <>
          <div className="mt-2 space-y-2">
            {count === 0 ? <div className="empty-mini">{emptyText}</div> : children}
          </div>
          {viewMoreHref && count > 10 ? <ViewMoreButton href={viewMoreHref} /> : null}
        </>
      ) : (
        isDragTarget ? <div className="mt-2 flex h-16 items-center justify-center rounded-2xl border border-dashed border-violet-300 text-xs font-bold text-violet-600">Drop here</div> : null
      )}
    </section>
  );
}
