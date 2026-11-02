"use client";

import type { ReactNode } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { TableLoadingSkeleton } from "@/components/ui/loading-skeleton";
import { cn } from "@/lib/utils/cn";
import { SortableColumnHeader, type SortDirection } from "./sortable-column-header";
import { readStateMessage, type ReadFailure } from "@/lib/ui/read-state";

export type DataTableColumn<T> = {
  id: string;
  header: string;
  accessor: (row: T) => ReactNode;
  sortable?: boolean;
  className?: string;
  cellClassName?: string;
  width?: number;
  sticky?: boolean;
  numeric?: boolean;
  mobile?: "identity" | "primary" | "secondary" | "hidden";
  mobileWhen?: (row: T) => boolean;
};

export function isRowActivationKey(key: string): boolean {
  return key === "Enter" || key === " ";
}

type DataTableProps<T> = {
  rows: T[];
  columns: DataTableColumn<T>[];
  mobileColumns?: DataTableColumn<T>[];
  getRowId: (row: T) => string;
  getRowHref?: (row: T) => string;
  onRowClick?: (row: T) => void;
  sortColumn?: string;
  sortDirection?: SortDirection;
  onSort?: (column: string, direction: SortDirection) => void;
  isLoading?: boolean;
  error?: string | null;
  failureKind?: ReadFailure;
  refreshing?: boolean;
  stale?: boolean;
  onRetry?: () => void;
  emptyTitle: string;
  emptyDescription: string;
  emptyAction?: ReactNode;
};

export function DataTable<T>({ rows, columns, mobileColumns = columns, getRowId, getRowHref, onRowClick, sortColumn, sortDirection, onSort, isLoading, error, failureKind = "failed", refreshing, stale, onRetry, emptyTitle, emptyDescription, emptyAction }: DataTableProps<T>) {
  if (isLoading) return <TableLoadingSkeleton columns={columns.length} />;
  const failure = readStateMessage(failureKind);
  if (error && (!rows.length || !stale || failureKind === "denied")) return <ErrorState title={failure.title} description={failure.description} onRetry={onRetry} />;
  if (!rows.length) {
    return (
      <div className="p-4">
        <EmptyState title={emptyTitle} description={emptyDescription} />
        {emptyAction ? <div className="mt-4 flex justify-center">{emptyAction}</div> : null}
      </div>
    );
  }

  function openRow(row: T) {
    if (onRowClick) return onRowClick(row);
    const href = getRowHref?.(row);
    if (href) window.location.assign(href);
  }

  const identity = mobileColumns.find((column) => column.mobile === "identity") ?? mobileColumns[0];

  function isNestedControl(target: EventTarget, current: EventTarget) {
    return target !== current && target instanceof Element && Boolean(target.closest("a,button,input,select,textarea,summary,details,[role='button']"));
  }

  return (
    <>
      {refreshing ? <p role="status" className="px-4 py-3 text-sm font-semibold text-neutral-600">Refreshing this view. Showing the last successful records.</p> : null}
      {error && stale ? <div role="alert" className="m-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><p className="font-bold">{readStateMessage("partial").title}</p><p>{readStateMessage("partial").description}</p>{onRetry ? <button type="button" className="mt-2 min-h-10 rounded-lg border border-amber-400 px-3 font-semibold" onClick={onRetry}>Retry refresh</button> : null}</div> : null}
      <div className="grid min-w-0 gap-3 p-4 md:hidden">
        {rows.map((row) => {
          const clickable = Boolean(onRowClick || getRowHref);
          const primary = mobileColumns.filter((column) => column !== identity && column.mobile === "primary" && (!column.mobileWhen || column.mobileWhen(row)));
          const primaryIds = new Set(primary.map((column) => column.id));
          const secondary = mobileColumns.filter((column) => column !== identity && !primaryIds.has(column.id) && column.mobile !== "hidden");
          return (
            <article
              key={getRowId(row)}
              className="min-w-0 rounded-[20px] border border-neutral-200 bg-white p-4 shadow-sm"
            >
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-neutral-500">{identity?.header}</p>
              <div className="mt-1 min-w-0 text-base font-bold text-neutral-950 [overflow-wrap:anywhere]">
                {clickable ? <button type="button" className="min-h-10 max-w-full rounded-lg text-left underline decoration-neutral-300 underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange" onClick={() => openRow(row)}>{identity?.accessor(row)}</button> : identity?.accessor(row)}
              </div>
              {primary.length ? <dl className="mt-3 grid min-w-0 gap-2 text-sm">
                {primary.map((column) => <div key={column.id} className="flex min-w-0 items-start justify-between gap-3"><dt className="max-w-[42%] text-xs font-semibold text-neutral-500">{column.header}</dt><dd className={cn("min-w-0 text-right font-semibold text-neutral-800 [overflow-wrap:anywhere]", column.numeric && "tabular-nums")}>{column.accessor(row)}</dd></div>)}
              </dl> : null}
              {secondary.length ? <details className="mt-3 border-t border-neutral-100 pt-2">
                <summary className="min-h-10 cursor-pointer rounded-lg py-2 text-sm font-semibold text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange">More details<span className="sr-only"> for {getRowId(row)}</span></summary>
                <div className="mt-2 grid min-w-0 gap-3 text-sm">
                {secondary.map((column) => (
                  <div key={column.id} className="flex min-w-0 items-start justify-between gap-4 has-[details]:flex-col has-[details]:items-stretch has-[details]:gap-2">
                     <span className="max-w-[42%] shrink-0 text-xs font-bold uppercase tracking-[0.1em] text-neutral-400">{column.header}</span>
                     <span className="min-w-0 flex-1 text-right font-semibold text-neutral-800 [overflow-wrap:anywhere] [&>*]:max-w-full [&_span]:whitespace-normal">{column.accessor(row)}</span>
                  </div>
                ))}
                </div>
              </details> : null}
            </article>
          );
        })}
      </div>
      <div className="hidden overflow-x-auto md:block">
        <table className="industrial-table min-w-[920px]">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.id} scope="col" className={cn(column.className, column.numeric && "text-right tabular-nums [&_button]:ml-auto", column.sticky && "sticky left-0 z-20 bg-white")} style={column.width ? { width: column.width, minWidth: column.width } : undefined}>
                  {column.sortable ? <SortableColumnHeader label={column.header} column={column.id} sortColumn={sortColumn} sortDirection={sortDirection} onSort={onSort} /> : column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const clickable = Boolean(onRowClick || getRowHref);
              return (
                 <tr key={getRowId(row)} role={clickable ? "link" : undefined} tabIndex={clickable ? 0 : undefined} aria-label={clickable ? `Open record ${getRowId(row)}` : undefined} className={cn(clickable && "cursor-pointer transition hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange")} onClick={clickable ? (event) => { if (!isNestedControl(event.target, event.currentTarget)) openRow(row); } : undefined} onKeyDown={clickable ? (event) => { if (event.target === event.currentTarget && isRowActivationKey(event.key)) { event.preventDefault(); openRow(row); } } : undefined}>
                  {columns.map((column) => <td key={column.id} className={cn(column.cellClassName, column.numeric && "text-right tabular-nums", column.sticky && "sticky left-0 z-10 bg-white")} style={column.width ? { width: column.width, minWidth: column.width } : undefined}>{column.accessor(row)}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
