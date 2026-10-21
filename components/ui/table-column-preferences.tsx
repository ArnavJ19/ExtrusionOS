"use client";

import { ArrowDown, ArrowUp, Columns3 } from "lucide-react";
import type { ColumnLayout, PreferenceColumn } from "@/lib/preferences/table-columns";
import { moveColumn } from "@/lib/preferences/table-columns";

export function TableColumnPreferences({ columns, layout, identifier, onChange }: {
  columns: readonly PreferenceColumn[];
  layout: ColumnLayout;
  identifier: string;
  onChange: (layout: ColumnLayout) => void;
}) {
  const ordered = [...layout.order.filter((id) => columns.some((column) => column.id === id)), ...columns.map((column) => column.id).filter((id) => !layout.order.includes(id))];
  const hidden = new Set(layout.hidden);
  return (
    <details className="relative">
      <summary className="inline-flex cursor-pointer list-none items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"><Columns3 className="h-4 w-4" /> Columns</summary>
      <div className="absolute right-0 z-40 mt-2 max-h-[min(75vh,38rem)] w-[min(92vw,27rem)] space-y-2 overflow-y-auto overscroll-contain rounded-2xl border border-neutral-200 bg-white p-4 shadow-xl">
        <p className="text-xs font-medium text-neutral-500">Choose, arrange, and size the columns for this list. {identifier ? "The record identifier stays visible." : ""}</p>
        {ordered.map((id, index) => {
          const column = columns.find((item) => item.id === id)!;
          const isIdentifier = id === identifier;
          const width = layout.widths[id] ?? 160;
          return <div key={id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 rounded-xl border border-neutral-100 p-2">
            <label className="flex min-w-0 items-center gap-2 text-sm font-semibold text-neutral-800">
              <input type="checkbox" checked={isIdentifier || !hidden.has(id)} disabled={isIdentifier} onChange={(event) => onChange({ ...layout, hidden: event.target.checked ? layout.hidden.filter((item) => item !== id) : [...new Set([...layout.hidden, id])] })} />
              <span className="truncate">{column.header}{isIdentifier ? " (identifier)" : ""}</span>
            </label>
            <div className="flex items-center gap-1">
              <button type="button" aria-label={`Move ${column.header} up`} disabled={index === 0 || isIdentifier || ordered[index - 1] === identifier} onClick={() => onChange({ ...layout, order: moveColumn(ordered.map((columnId) => columns.find((item) => item.id === columnId)!), id, -1, identifier).map((item) => item.id) })} className="rounded p-1 text-neutral-500 hover:bg-neutral-100 disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
              <button type="button" aria-label={`Move ${column.header} down`} disabled={index === ordered.length - 1 || isIdentifier} onClick={() => onChange({ ...layout, order: moveColumn(ordered.map((columnId) => columns.find((item) => item.id === columnId)!), id, 1, identifier).map((item) => item.id) })} className="rounded p-1 text-neutral-500 hover:bg-neutral-100 disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
            </div>
            <label className="col-span-2 mt-1 flex items-center gap-2 text-xs text-neutral-500">Width <input type="range" aria-label={`Width for ${column.header}`} min="80" max="480" step="10" value={width} onChange={(event) => onChange({ ...layout, widths: { ...layout.widths, [id]: Number(event.target.value) } })} className="min-w-0 flex-1" /><span className="w-12 text-right tabular-nums">{width}px</span></label>
          </div>;
        })}
      </div>
    </details>
  );
}
