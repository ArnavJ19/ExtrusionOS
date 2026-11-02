export type NumericInput = number | string | null | undefined;
export type NumericKind = "number" | "pieces" | "weight" | "sectionWeight" | "metres" | "currency" | "percent";

export function numericKindForField(path: string, type: NumericKind): NumericKind {
  const field = path.split(".").at(-1) ?? path;
  if (type === "weight" && /(?:kg_per_m|weight_per_meter_actual)$/.test(field)) return "sectionWeight";
  if (type !== "number") return type;
  if (field === "pieces" || field.endsWith("_pieces")) return "pieces";
  if (field.endsWith("_percent") || field.endsWith("_percentage")) return "percent";
  if (["length_m", "length_per_piece_m", "standard_length_m", "profile_length_m", "total_length_m", "piece_length_m"].includes(field)) return "metres";
  return type;
}

export function readDisplayNumber(value: NumericInput): number | null {
  if (value == null || (typeof value === "string" && !value.trim())) return null;
  if (typeof value !== "number" && (typeof value !== "string" || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()))) return NaN;
  return Number(value);
}

export function formatNumeric(value: NumericInput, kind: NumericKind = "number", currency = "INR") {
  const number = readDisplayNumber(value);
  if (number === null) return "Not captured";
  if (!Number.isFinite(number) || (kind === "pieces" && !Number.isSafeInteger(number))) return "Unavailable";
  const digits = ["weight", "sectionWeight"].includes(kind) ? 3 : ["currency", "metres"].includes(kind) ? 2 : 0;
  try {
    const formatted = new Intl.NumberFormat("en-IN", {
      ...(kind === "currency" ? { style: "currency", currency } : {}),
      minimumFractionDigits: digits,
      maximumFractionDigits: kind === "number" ? 3 : kind === "percent" ? 2 : digits
    }).format(number!);
    return `${formatted}${kind === "weight" ? " kg" : kind === "sectionWeight" ? " kg/m" : kind === "metres" ? " m" : kind === "pieces" ? " pcs" : kind === "percent" ? "%" : ""}`;
  } catch {
    return "Unavailable";
  }
}

export function formatRate(value: NumericInput, unit: "kg" | "m" | "piece", currency = "INR") {
  const amount = formatNumeric(value, "currency", currency);
  return amount === "Not captured" || amount === "Unavailable" ? amount : `${amount}/${unit}`;
}
