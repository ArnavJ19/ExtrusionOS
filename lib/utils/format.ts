import { format } from "date-fns";
import { formatNumeric, readDisplayNumber } from "./numeric-display.ts";

export function formatCurrency(value: number | string | null | undefined) {
  return formatNumeric(value, "currency");
}

export function formatCompactCurrency(value: number | string | null | undefined) {
  const amount = readDisplayNumber(value);
  if (amount === null || !Number.isFinite(amount)) return formatCurrency(value);
  if (Math.abs(amount) >= 10000000) return `\u20B9${(amount / 10000000).toFixed(2)}Cr`;
  if (Math.abs(amount) >= 100000) return `\u20B9${(amount / 100000).toFixed(2)}L`;
  return formatCurrency(amount);
}

export function formatWeight(value: number | string | null | undefined) {
  return formatNumeric(value, "weight");
}

export function formatMeters(value: number | string | null | undefined) {
  return formatNumeric(value, "metres");
}

export function formatPercent(value: number | string | null | undefined) {
  return formatNumeric(value, "percent");
}

export function formatDate(value: string | Date | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return format(date, "dd MMM yyyy");
}

export function todayIso(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
