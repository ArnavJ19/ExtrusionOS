import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils/format";
import { formatNumeric, numericKindForField, type NumericKind } from "@/lib/utils/numeric-display";

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
  if (["currency", "weight", "number", "pieces", "metres", "percent"].includes(type ?? "")) {
    const currency = typeof row.currency === "string" && row.currency ? row.currency : "INR";
    const kind = numericKindForField(path, type as NumericKind);
    const formatted = formatNumeric(value, kind, currency);
    return <span className="tabular-nums" title={value == null ? undefined : `${String(value)}${kind === "sectionWeight" ? " kg/m" : kind === "weight" ? " kg" : type === "currency" ? ` ${currency}` : ""}`}>{formatted}</span>;
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return value == null || value === "" ? "-" : String(value);
}

export function titleValue(row: Record<string, any>, path: string) {
  const value = getPath(row, path) ?? (path.endsWith("company_name") ? getPath(row, path.replace("company_name", "customer_name")) : null);
  return value == null || value === "" ? "Untitled" : String(value);
}
