// AP-086: date-range chips for database filters. Days are Indian Standard Time calendar days; the week starts on Monday
// and the financial year on 1 April. Ranges end today (never in the future) except "Last month", which is complete.

export const DATE_PRESETS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "this_week", label: "This week" },
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "this_fy", label: "This FY" }
] as const;
export type DatePresetKey = (typeof DATE_PRESETS)[number]["key"];
export type DateRange = { from: string; to: string };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));

/** Today's IST calendar date as YYYY-MM-DD. */
export function istDate(now: Date = new Date()): string {
  return iso(new Date(now.getTime() + 5.5 * 3600 * 1000));
}

export function presetRange(key: DatePresetKey, today: string = istDate()): DateRange {
  const [y, m, d] = today.split("-").map(Number);
  const t = utc(y, m - 1, d);
  switch (key) {
    case "today": return { from: today, to: today };
    case "yesterday": { const p = iso(utc(y, m - 1, d - 1)); return { from: p, to: p }; }
    case "this_week": { const back = (t.getUTCDay() + 6) % 7; return { from: iso(utc(y, m - 1, d - back)), to: today }; }
    case "this_month": return { from: iso(utc(y, m - 1, 1)), to: today };
    case "last_month": return { from: iso(utc(y, m - 2, 1)), to: iso(utc(y, m - 1, 0)) };
    case "this_fy": return { from: iso(utc(m >= 4 ? y : y - 1, 3, 1)), to: today };
  }
}

/** The chip whose range equals the current filter, if any. */
export function activePreset(range: DateRange, today: string = istDate()): DatePresetKey | null {
  if (!range.from && !range.to) return null;
  return DATE_PRESETS.find(p => { const r = presetRange(p.key, today); return r.from === range.from && r.to === range.to; })?.key ?? null;
}
