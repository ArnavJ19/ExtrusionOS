"use client";

import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export type SortDirection = "asc" | "desc";

type SortableColumnHeaderProps = {
  label: string;
  column: string;
  sortColumn?: string;
  sortDirection?: SortDirection;
  onSort?: (column: string, direction: SortDirection) => void;
  className?: string;
};

export function SortableColumnHeader({ label, column, sortColumn, sortDirection = "asc", onSort, className }: SortableColumnHeaderProps) {
  const active = sortColumn === column;
  const nextDirection: SortDirection = active && sortDirection === "asc" ? "desc" : "asc";
  const Icon = active ? (sortDirection === "asc" ? ArrowUp : ArrowDown) : ChevronsUpDown;

  return (
    <button
      type="button"
      className={cn("inline-flex items-center gap-1.5 text-left font-black text-slate-600 transition hover:text-orange", active && "text-slate-950", className)}
      onClick={() => onSort?.(column, nextDirection)}
      disabled={!onSort}
    >
      {label}
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}
