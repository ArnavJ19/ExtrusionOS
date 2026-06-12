import { cn } from "@/lib/utils/cn";

export function LoadingSkeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-2xl bg-slate-200/80", className)} />;
}

export function TableLoadingSkeleton({ rows = 10, columns = 6 }: { rows?: number; columns?: number }) {
  return (
    <div className="space-y-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {Array.from({ length: columns }).map((_, index) => <LoadingSkeleton key={`head-${index}`} className="h-5" />)}
      </div>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={`row-${rowIndex}`} className="grid gap-3 border-t border-slate-100 pt-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {Array.from({ length: columns }).map((_, columnIndex) => <LoadingSkeleton key={`${rowIndex}-${columnIndex}`} className="h-8" />)}
        </div>
      ))}
    </div>
  );
}

export function CardLoadingSkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: cards }).map((_, index) => (
        <div key={index} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <LoadingSkeleton className="h-5 w-1/2" />
          <LoadingSkeleton className="mt-3 h-4 w-3/4" />
          <LoadingSkeleton className="mt-5 h-16" />
        </div>
      ))}
    </div>
  );
}
