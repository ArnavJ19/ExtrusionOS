"use client";

import { Button } from "@/components/ui/button";

type DataTablePaginationProps = {
  page: number;
  pageSize?: number;
  totalCount?: number | null;
  hasNextPage?: boolean;
  isLoading?: boolean;
  onPrevious: () => void;
  onNext: () => void;
};

export function DataTablePagination({ page, pageSize = 10, totalCount, hasNextPage, isLoading, onPrevious, onNext }: DataTablePaginationProps) {
  const first = (page - 1) * pageSize + 1;
  const last = totalCount == null ? page * pageSize : Math.min(page * pageSize, totalCount);
  const canGoNext = hasNextPage ?? (totalCount == null ? true : page * pageSize < totalCount);

  return (
    <div className="flex flex-col gap-3 border-t border-neutral-100 px-4 py-3 text-sm font-semibold text-neutral-500 sm:flex-row sm:items-center sm:justify-between">
      <p>{totalCount == null ? `Page ${page}` : totalCount === 0 ? "No records" : `Showing ${first}-${last} of ${totalCount}`}</p>
      <div className="flex items-center gap-2">
        <Button type="button" variant="secondary" disabled={page <= 1 || isLoading} onClick={onPrevious}>Previous</Button>
        <span className="rounded-xl bg-neutral-100 px-3 py-2 text-xs font-bold uppercase tracking-[0.12em] text-neutral-600">Page {page}</span>
        <Button type="button" variant="secondary" disabled={!canGoNext || isLoading} onClick={onNext}>Next</Button>
      </div>
    </div>
  );
}
