// AP-033: suggested reorder point and quantity, mirrored by private.ap6_reorder_row (a test compares them).
// Average daily use over the observed window (at most 90 days) × (supplier lead time + safety days) is the reorder
// point; average daily use × review days is the reorder quantity. Without 14 days of history, any consumption, or a
// supplier lead time there is no suggestion: the value stays blank rather than zero.

export type ReorderState = "suggested" | "lead_time_missing" | "insufficient_history" | "not_consumed";

export function suggestReorder(input: { consumed: number; windowDays: number; leadDays: number | null; safetyDays?: number | null; reviewDays?: number }) {
  const days = Math.max(0, Math.min(90, Math.floor(input.windowDays)));
  if (days < 14) return { state: "insufficient_history" as ReorderState, min: null, qty: null, avgDaily: null };
  if (!(input.consumed > 0)) return { state: "not_consumed" as ReorderState, min: null, qty: null, avgDaily: 0 };
  const avgDaily = input.consumed / days;
  if (input.leadDays === null || !(input.leadDays > 0)) return { state: "lead_time_missing" as ReorderState, min: null, qty: null, avgDaily };
  const safety = input.safetyDays ?? Math.ceil(input.leadDays / 2);
  const up = (value: number) => Math.ceil(value * 1000 - 1e-9) / 1000;
  return { state: "suggested" as ReorderState, min: up(avgDaily * (input.leadDays + safety)), qty: up(avgDaily * (input.reviewDays ?? 30)), avgDaily };
}
