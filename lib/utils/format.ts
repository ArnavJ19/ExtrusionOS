import { format } from "date-fns";

function safeNumber(value: number | string | null | undefined) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

export function formatCurrency(value: number | string | null | undefined) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 }).format(safeNumber(value));
}

export function formatCompactCurrency(value: number | string | null | undefined) {
  const amount = safeNumber(value);
  if (amount >= 10000000) return `\u20B9${(amount / 10000000).toFixed(2)}Cr`;
  if (amount >= 100000) return `\u20B9${(amount / 100000).toFixed(2)}L`;
  return formatCurrency(amount);
}

export function formatWeight(value: number | string | null | undefined) {
  return `${new Intl.NumberFormat("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(safeNumber(value))} kg`;
}

export function formatMeters(value: number | string | null | undefined) {
  return `${new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(safeNumber(value))} m`;
}

export function formatPercent(value: number | string | null | undefined) {
  return `${safeNumber(value).toFixed(2).replace(/\.00$/, "")}%`;
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
