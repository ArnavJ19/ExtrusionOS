// Phase 4 display helpers. Arithmetic stays in the database read models; these only format what they return.

/** Kilograms as tonnes with one decimal ("12.3 t"); blank stays blank, never zero. */
export function tonnes(kg: unknown): string {
  const n = typeof kg === "number" ? kg : typeof kg === "string" && kg.trim() !== "" ? Number(kg) : NaN;
  if (!Number.isFinite(n)) return "—";
  return `${(Math.round(n / 100) / 10).toLocaleString("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} t`;
}

/** Kilograms with Indian digit grouping and no decimals ("1,23,456 kg"). */
export function kgText(kg: unknown): string {
  const n = typeof kg === "number" ? kg : typeof kg === "string" && kg.trim() !== "" ? Number(kg) : NaN;
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n).toLocaleString("en-IN")} kg`;
}

/** A percentage the database already rounded; null means "not enough data", shown as a dash. */
export function pct(value: unknown): string {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? `${n.toLocaleString("en-IN", { maximumFractionDigits: 1 })}%` : "—";
}

/** A WhatsApp share link the person opens and sends themselves (no provider, nothing sent automatically). */
export function whatsappShareUrl(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message.slice(0, 3500))}`;
}

/** "just now", "2 min ago", "1 h ago" for the live-screen freshness label (FS-36). */
export function freshness(updatedAt: number | null, now: number): string {
  if (updatedAt === null) return "not yet";
  const seconds = Math.max(0, Math.round((now - updatedAt) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
}

/** Days of slack between a planned end and a promise, as text for the breakdown re-flow list. */
export function slackText(days: number | null | undefined): string {
  if (days === null || days === undefined || !Number.isFinite(Number(days))) return "No promise date";
  const n = Number(days);
  if (n < 0) return `${Math.abs(n)} day${Math.abs(n) === 1 ? "" : "s"} past the promise`;
  return `${n} day${n === 1 ? "" : "s"} of slack`;
}
