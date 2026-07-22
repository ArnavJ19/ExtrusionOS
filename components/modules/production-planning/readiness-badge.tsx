import { Badge } from "@/components/ui/badge";

export function ReadinessBadge({ status }: { status: string | null | undefined }) {
  const value = status || "pending";
  const className =
    value === "complete" || value === "ready"
      ? "bg-emerald-50 text-emerald-700"
      : value === "shortage" || value === "partial"
        ? "bg-amber-50 text-amber-700"
        : value === "blocked" || value === "cancelled"
          ? "bg-red-50 text-red-700"
          : "bg-slate-100 text-slate-700";

  return <Badge value={value} className={className} />;
}
