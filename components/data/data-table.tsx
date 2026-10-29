"use client";

import type { ReactNode } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { TableLoadingSkeleton } from "@/components/ui/loading-skeleton";
import { cn } from "@/lib/utils/cn";
import { SortableColumnHeader, type SortDirection } from "./sortable-column-header";

export type DataTableColumn<T> = {
  id: string;
  header: string;
  accessor: (row: T) => ReactNode;
  sortable?: boolean;
  className?: string;
  cellClassName?: string;
  width?: number;
  sticky?: boolean;
};

export function isRowActivationKey(key: string): boolean {
  return key === "Enter" || key === " ";
}

type DataTableProps<T> = {
  rows: T[];
  columns: DataTableColumn<T>[];
  getRowId: (row: T) => string;
  getRowHref?: (row: T) => string;
  onRowClick?: (row: T) => void;
  sortColumn?: string;
  sortDirection?: SortDirection;
  onSort?: (column: string, direction: SortDirection) => void;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  emptyTitle: string;
  emptyDescription: string;
  emptyAction?: ReactNode;
};

export function DataTable<T>({ rows, columns, getRowId, getRowHref, onRowClick, sortColumn, sortDirection, onSort, isLoading, error, onRetry, emptyTitle, emptyDescription, emptyAction }: DataTableProps<T>) {
  if (isLoading) return <TableLoadingSkeleton columns={columns.length} />;
  if (error) return <ErrorState description={error} onRetry={onRetry} />;
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

  return (
    <>
      <div className="grid min-w-0 gap-3 p-4 md:hidden">
        {rows.map((row) => {
          const clickable = Boolean(onRowClick || getRowHref);
          return (
            <div
              key={getRowId(row)}
              role={clickable ? "button" : undefined}
              tabIndex={clickable ? 0 : undefined}
              className={cn("min-w-0 rounded-[20px] border border-neutral-200 bg-white p-4 shadow-sm", clickable && "cursor-pointer transition hover:border-neutral-300 hover:bg-neutral-50")}
              onClick={clickable ? () => openRow(row) : undefined}
              onKeyDown={clickable ? (event) => { if (event.target === event.currentTarget && isRowActivationKey(event.key)) { event.preventDefault(); openRow(row); } } : undefined}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                   <p className="text-xs font-bold uppercase tracking-[0.12em] text-neutral-400">{columns[0]?.header}</p>
                   <div className="mt-1 text-base font-bold text-neutral-950">{columns[0]?.accessor(row)}</div>
                </div>
                 {columns[2] ? <div className="min-w-0 max-w-[42%] text-right text-xs font-semibold text-neutral-600 [overflow-wrap:anywhere] [&_span]:whitespace-normal">{columns[2].accessor(row)}</div> : null}
              </div>
               <div className="mt-4 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 border-t border-neutral-100 pt-4 text-sm">
                {columns.slice(1).map((column) => (
                  <div key={column.id} className="flex min-w-0 items-start justify-between gap-4 has-[details]:flex-col has-[details]:items-stretch has-[details]:gap-2">
                     <span className="max-w-[42%] shrink-0 text-xs font-bold uppercase tracking-[0.1em] text-neutral-400">{column.header}</span>
                     <span className="min-w-0 flex-1 text-right font-semibold text-neutral-800 [overflow-wrap:anywhere] [&>*]:max-w-full [&_span]:whitespace-normal">{column.accessor(row)}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="hidden overflow-x-auto md:block">
        <table className="industrial-table min-w-[920px]">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.id} className={cn(column.className, column.sticky && "sticky left-0 z-20 bg-white")} style={column.width ? { width: column.width, minWidth: column.width } : undefined}>
                  {column.sortable ? <SortableColumnHeader label={column.header} column={column.id} sortColumn={sortColumn} sortDirection={sortDirection} onSort={onSort} /> : column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const clickable = Boolean(onRowClick || getRowHref);
              return (
                 <tr key={getRowId(row)} role={clickable ? "link" : undefined} tabIndex={clickable ? 0 : undefined} aria-label={clickable ? `Open record ${getRowId(row)}` : undefined} className={cn(clickable && "cursor-pointer transition hover:bg-neutral-50")} onClick={clickable ? () => openRow(row) : undefined} onKeyDown={clickable ? (event) => { if (event.target === event.currentTarget && isRowActivationKey(event.key)) { event.preventDefault(); openRow(row); } } : undefined}>
                  {columns.map((column) => <td key={column.id} className={cn(column.cellClassName, column.sticky && "sticky left-0 z-10 bg-white")} style={column.width ? { width: column.width, minWidth: column.width } : undefined}>{column.accessor(row)}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
