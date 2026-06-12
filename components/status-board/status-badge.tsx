import { Badge } from "@/components/ui/badge";

export function StatusBadge({ value, className }: { value: string; className?: string }) {
  return <Badge value={value} className={className} />;
}

export function PriorityBadge({ value }: { value?: string | null }) {
  return <Badge value={value || "normal"} />;
}
