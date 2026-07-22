"use client";

import { useState, useCallback, type ReactNode, type DragEvent } from "react";
import { CardLoadingSkeleton } from "@/components/ui/loading-skeleton";
import { ErrorState } from "@/components/ui/error-state";
import { StatusColumn } from "./status-column";

type StatusBoardProps<T> = {
  statuses: string[];
  records: T[];
  getStatus: (record: T) => string;
  getCount?: (status: string) => number;
  renderCard: (record: T) => ReactNode;
  sortRecords?: (a: T, b: T) => number;
  emptyText?: string;
  getViewMoreHref?: (status: string) => string;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** Called when a card is dragged to a different status column. Return value is ignored. */
  onStatusChange?: (recordId: string, newStatus: string) => void;
  /** Extract the unique ID from a record. Defaults to (record as any).id */
  getRecordId?: (record: T) => string;
};

const DRAG_TYPE = "application/x-status-board";
export const STATUS_BOARD_PREVIEW_LIMIT = 5;

export function StatusBoard<T>({ statuses, records, getStatus, getCount, renderCard, sortRecords, emptyText = "No records in this status.", getViewMoreHref, isLoading, error, onRetry, onStatusChange, getRecordId }: StatusBoardProps<T>) {
  const [dragOverStatus, setDragOverStatus] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const getId = useCallback((record: T) => getRecordId ? getRecordId(record) : (record as any).id as string, [getRecordId]);

  const handleDragStart = useCallback((e: DragEvent, record: T, currentStatus: string) => {
    const id = getId(record);
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ id, fromStatus: currentStatus }));
    e.dataTransfer.effectAllowed = "move";
    setDraggingId(id);
  }, [getId]);

  const handleDragOver = useCallback((e: DragEvent, status: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverStatus(status);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    // Only clear if we're leaving the column entirely (not entering a child)
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragOverStatus(null);
  }, []);

  const handleDrop = useCallback((e: DragEvent, targetStatus: string) => {
    e.preventDefault();
    setDragOverStatus(null);
    setDraggingId(null);
    try {
      const raw = e.dataTransfer.getData(DRAG_TYPE);
      if (!raw) return;
      const { id, fromStatus } = JSON.parse(raw) as { id: string; fromStatus: string };
      if (fromStatus === targetStatus) return; // same column, no-op
      onStatusChange?.(id, targetStatus);
    } catch { /* ignore bad data */ }
  }, [onStatusChange]);

  const handleDragEnd = useCallback(() => {
    setDragOverStatus(null);
    setDraggingId(null);
  }, []);

  if (isLoading) return <CardLoadingSkeleton />;
  if (error) return <ErrorState description={error} onRetry={onRetry} />;

  const isDragEnabled = !!onStatusChange;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 items-start">
      {statuses.map((status) => {
        const matching = records.filter((record) => getStatus(record) === status);
        const grouped = matching.sort(sortRecords).slice(0, STATUS_BOARD_PREVIEW_LIMIT);
        const total = getCount?.(status) ?? matching.length;
        return (
          <StatusColumn
            key={status}
            status={status}
            count={total}
            emptyText={emptyText}
            viewMoreHref={total > STATUS_BOARD_PREVIEW_LIMIT ? getViewMoreHref?.(status) : undefined}
            defaultExpanded={false}
            onDragOver={isDragEnabled ? (e) => handleDragOver(e, status) : undefined}
            onDragLeave={isDragEnabled ? handleDragLeave : undefined}
            onDrop={isDragEnabled ? (e) => handleDrop(e, status) : undefined}
            isDragTarget={dragOverStatus === status}
          >
            {grouped.map((record) => {
              const id = getId(record);
              return (
                <div
                  key={id}
                  draggable={isDragEnabled}
                  onDragStart={isDragEnabled ? (e) => handleDragStart(e, record, status) : undefined}
                  onDragEnd={isDragEnabled ? handleDragEnd : undefined}
                  className={`${isDragEnabled ? "cursor-grab active:cursor-grabbing" : ""} ${draggingId === id ? "opacity-40" : ""}`}
                >
                  {renderCard(record)}
                </div>
              );
            })}
          </StatusColumn>
        );
      })}
    </div>
  );
}
