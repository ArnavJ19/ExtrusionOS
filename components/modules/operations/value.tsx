import { Badge } from "@/components/ui/badge";
import { NumberTicker } from "@/components/ui/number-ticker";
import { formatDate } from "@/lib/utils/format";

export function getPath(row: Record<string, any>, path: string): any {
  return path.split(".").reduce((value, key) => {
    if (Array.isArray(value)) return value[0]?.[key];
    return value?.[key];
  }, row);
}

export function displayValue(row: Record<string, any>, path: string, type?: string) {
  const value = getPath(row, path) ?? (path.endsWith("company_name") ? getPath(row, path.replace("company_name", "customer_name")) : null);
  if (type === "badge" && value) return <Badge value={String(value)} />;
  if (type === "date") return formatDate(value);
  if (type === "currency") return <NumberTicker value={Number(value ?? 0)} prefix="₹" decimals={0} />;
  if (type === "weight") return <NumberTicker value={Number(value ?? 0)} suffix=" kg" decimals={3} />;
  if (type === "number") return <NumberTicker value={Number(value ?? 0)} />;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return value == null || value === "" ? "-" : String(value);
}

export function titleValue(row: Record<string, any>, path: string) {
  const value = getPath(row, path) ?? (path.endsWith("company_name") ? getPath(row, path.replace("company_name", "customer_name")) : null);
  return value == null || value === "" ? "Untitled" : String(value);
}
