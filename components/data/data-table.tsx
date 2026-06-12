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
};

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
      <div className="grid gap-3 p-4 md:hidden">
        {rows.map((row) => {
          const clickable = Boolean(onRowClick || getRowHref);
          return (
            <div
              key={getRowId(row)}
              role={clickable ? "button" : undefined}
              tabIndex={clickable ? 0 : undefined}
              className={cn("rounded-[20px] border border-neutral-200 bg-white p-4 shadow-sm", clickable && "cursor-pointer transition hover:border-neutral-300 hover:bg-neutral-50")}
              onClick={clickable ? () => openRow(row) : undefined}
              onKeyDown={clickable ? (event) => { if (event.key === "Enter" || event.key === " ") openRow(row); } : undefined}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                   <p className="text-xs font-bold uppercase tracking-[0.12em] text-neutral-400">{columns[0]?.header}</p>
                   <div className="mt-1 text-base font-bold text-neutral-950">{columns[0]?.accessor(row)}</div>
                </div>
                 {columns[2] ? <div className="text-right text-xs font-semibold text-neutral-600">{columns[2].accessor(row)}</div> : null}
              </div>
               <div className="mt-4 grid gap-3 border-t border-neutral-100 pt-4 text-sm">
                {columns.slice(1).map((column) => (
                  <div key={column.id} className="flex items-start justify-between gap-4">
                     <span className="text-xs font-bold uppercase tracking-[0.1em] text-neutral-400">{column.header}</span>
                     <span className="text-right font-semibold text-neutral-800">{column.accessor(row)}</span>
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
                <th key={column.id} className={column.className}>
                  {column.sortable ? <SortableColumnHeader label={column.header} column={column.id} sortColumn={sortColumn} sortDirection={sortDirection} onSort={onSort} /> : column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const clickable = Boolean(onRowClick || getRowHref);
              return (
                 <tr key={getRowId(row)} className={cn(clickable && "cursor-pointer transition hover:bg-neutral-50")} onClick={clickable ? () => openRow(row) : undefined}>
                  {columns.map((column) => <td key={column.id} className={column.cellClassName}>{column.accessor(row)}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
