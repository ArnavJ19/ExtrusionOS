// UPGRADE_EOS feature 25: compare two recorded versions of a quotation.
// Inputs are the role-projected versions returned by public.quote_revision_compare, so a field
// the reader may not see is simply absent on both sides and never reported as a change.
// quote_items are rewritten on every save, so lines are paired structurally: by profile, first
// on identical cut length and finish, then in entry order. Unpaired lines are added or removed.
import { z } from "zod";

export type FieldUnit = "pcs" | "m" | "kg" | "kg/m" | "inr" | "inr/kg" | "inr/m" | "percent" | "date" | "text";
type FieldSpec = { key: string; label: string; unit: FieldUnit };

export const HEADER_FIELDS: FieldSpec[] = [
  { key: "customer_id", label: "Customer", unit: "text" },
  { key: "quote_date", label: "Quote date", unit: "date" },
  { key: "valid_until", label: "Valid until", unit: "date" },
  { key: "payment_terms", label: "Payment terms", unit: "text" },
  { key: "delivery_timeline", label: "Delivery timeline", unit: "text" },
  { key: "terms_and_conditions", label: "Terms and conditions", unit: "text" },
  { key: "notes", label: "Notes", unit: "text" },
  { key: "gst_percent", label: "GST", unit: "percent" },
  { key: "subtotal", label: "Subtotal", unit: "inr" },
  { key: "total_before_gst", label: "Total before GST", unit: "inr" },
  { key: "gst_amount", label: "GST amount", unit: "inr" },
  { key: "grand_total", label: "Grand total", unit: "inr" },
  { key: "total_margin_amount", label: "Total margin", unit: "inr" },
  { key: "estimated_profit_percent", label: "Estimated profit", unit: "percent" }
];

export const LINE_FIELDS: FieldSpec[] = [
  { key: "profile_id", label: "Profile", unit: "text" },
  { key: "quantity_pieces", label: "Pieces", unit: "pcs" },
  { key: "length_per_piece_m", label: "Cut length", unit: "m" },
  { key: "total_meters", label: "Total length", unit: "m" },
  { key: "section_weight_kg_per_m", label: "Section weight", unit: "kg/m" },
  { key: "total_weight_kg", label: "Theoretical weight", unit: "kg" },
  { key: "billing_weight_kg", label: "Billing weight", unit: "kg" },
  { key: "finishing_type", label: "Finish", unit: "text" },
  { key: "finishing_charge_type", label: "Finish charge basis", unit: "text" },
  { key: "drawing_revision", label: "Drawing revision", unit: "text" },
  { key: "die_id", label: "Die", unit: "text" },
  { key: "expected_recovery_percent", label: "Expected recovery", unit: "percent" },
  { key: "price_per_kg", label: "Price", unit: "inr/kg" },
  { key: "price_per_meter", label: "Price", unit: "inr/m" },
  { key: "sales_price_override", label: "Sales price override", unit: "inr/kg" },
  { key: "discount", label: "Discount", unit: "inr" },
  { key: "line_total_before_gst", label: "Line total before GST", unit: "inr" },
  { key: "billet_rate_per_kg", label: "Billet rate", unit: "inr/kg" },
  { key: "conversion_charge_per_kg", label: "Conversion charge", unit: "inr/kg" },
  { key: "finishing_charge", label: "Finishing charge", unit: "inr" },
  { key: "die_charge", label: "Die charge", unit: "inr" },
  { key: "packing_charge", label: "Packing charge", unit: "inr" },
  { key: "transport_charge", label: "Transport charge", unit: "inr" },
  { key: "other_charges", label: "Other charges", unit: "inr" },
  { key: "margin_percent", label: "Margin", unit: "percent" }
];

const NUMERIC_UNITS = new Set<FieldUnit>(["pcs", "m", "kg", "kg/m", "inr", "inr/kg", "inr/m", "percent"]);
// Comparison tolerance per unit, matching the stored precision of each quantity.
const TOLERANCE: Partial<Record<FieldUnit, number>> = { pcs: 0, m: 0.0005, kg: 0.0005, "kg/m": 0.0000005, inr: 0.005, "inr/kg": 0.005, "inr/m": 0.005, percent: 0.005 };

const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const row = z.record(z.string(), z.unknown());
const side = z.object({
  kind: z.enum(["snapshot", "current"]),
  revision_number: z.number().int().nonnegative(),
  recorded_at: z.string().nullable(),
  superseded_at: z.string().nullable(),
  superseded_by: z.string().nullable(),
  reason: z.string().nullable(),
  approved_by_name: z.string().nullable(),
  header: row,
  items: z.array(row).max(500)
});
export const compareResponseSchema = z.object({
  level: z.enum(["basic", "price", "dealer", "cost"]),
  quote: z.object({ id: z.string().uuid(), quote_number: z.string(), status: z.string(), current_revision: z.number().int().nonnegative() }),
  versions: z.array(z.object({ revision_number: z.number().int().nonnegative(), revised_at: z.string(), reason: z.string().nullable(), status: z.string().nullable() })).max(1000),
  linked_order: z.object({ order_number: z.string(), created_at: z.string() }).nullable(),
  from: side,
  to: side
});
export type CompareResponse = z.infer<typeof compareResponseSchema>;
export type VersionSide = CompareResponse["from"];

export type FieldChange = { key: string; label: string; unit: FieldUnit; before: unknown; after: unknown; delta: number | null };
export type LineComparison = {
  status: "added" | "removed" | "changed" | "unchanged";
  profileId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  changes: FieldChange[];
};

function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalise(value: unknown, unit: FieldUnit): unknown {
  if (value === undefined || value === "") return null;
  if (NUMERIC_UNITS.has(unit)) return numeric(value);
  if (unit === "date" && typeof value === "string") return value.slice(0, 10);
  if (typeof value === "string") return value.trim() || null;
  return scalar.safeParse(value).success ? value : JSON.stringify(value);
}

/** Changed fields between two rows. A key absent from both rows (projected away) is ignored. */
export function diffFields(before: Record<string, unknown>, after: Record<string, unknown>, specs: FieldSpec[]): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const spec of specs) {
    if (!(spec.key in before) && !(spec.key in after)) continue;
    const a = normalise(before[spec.key], spec.unit);
    const b = normalise(after[spec.key], spec.unit);
    if (NUMERIC_UNITS.has(spec.unit) && typeof a === "number" && typeof b === "number") {
      if (Math.abs(a - b) <= (TOLERANCE[spec.unit] ?? 0)) continue;
      changes.push({ ...spec, before: a, after: b, delta: b - a });
      continue;
    }
    if (a === b) continue;
    changes.push({ ...spec, before: a, after: b, delta: null });
  }
  return changes;
}

const lineKey = (line: Record<string, unknown>) => [normalise(line.length_per_piece_m, "m"), normalise(line.finishing_type, "text")].join("|");

/** Pairs lines of the same profile, preferring identical cut length and finish, then entry order. */
export function pairLines(before: Record<string, unknown>[], after: Record<string, unknown>[]) {
  const pairs: { before: Record<string, unknown> | null; after: Record<string, unknown> | null }[] = [];
  const usedAfter = new Set<number>();
  const pending: number[] = [];
  before.forEach((line, index) => {
    const exact = after.findIndex((candidate, j) => !usedAfter.has(j) && candidate.profile_id === line.profile_id && lineKey(candidate) === lineKey(line));
    if (exact >= 0) { usedAfter.add(exact); pairs[index] = { before: line, after: after[exact] }; }
    else pending.push(index);
  });
  for (const index of pending) {
    const line = before[index];
    const sameProfile = after.findIndex((candidate, j) => !usedAfter.has(j) && candidate.profile_id === line.profile_id);
    if (sameProfile >= 0) { usedAfter.add(sameProfile); pairs[index] = { before: line, after: after[sameProfile] }; }
    else pairs[index] = { before: line, after: null };
  }
  after.forEach((line, j) => { if (!usedAfter.has(j)) pairs.push({ before: null, after: line }); });
  return pairs;
}

export function compareQuoteVersions(from: Pick<VersionSide, "header" | "items">, to: Pick<VersionSide, "header" | "items">) {
  const header = diffFields(from.header, to.header, HEADER_FIELDS);
  const lines: LineComparison[] = pairLines(from.items, to.items).map(({ before, after }) => {
    const profileId = String((after ?? before)?.profile_id ?? "") || null;
    if (!before) return { status: "added", profileId, before: null, after, changes: [] };
    if (!after) return { status: "removed", profileId, before, after: null, changes: [] };
    const changes = diffFields(before, after, LINE_FIELDS);
    return { status: changes.length ? "changed" : "unchanged", profileId, before, after, changes };
  });
  const count = (status: LineComparison["status"]) => lines.filter((line) => line.status === status).length;
  return {
    header,
    lines,
    summary: { added: count("added"), removed: count("removed"), changed: count("changed"), unchanged: count("unchanged"), headerChanges: header.length }
  };
}

/** A version that went to the customer or was accepted; later revisions supersede it. */
export function isIssuedStatus(status: unknown) {
  return typeof status === "string" && ["approved_for_sending", "sent", "customer_approved", "customer_rejected", "expired", "converted_to_order"].includes(status);
}

/** Parses ?compareFrom=&compareTo= where each side is a revision number or "current". */
export function parseCompareParams(fromValue: unknown, toValue: unknown): { from: number | null; to: number | null } | null {
  const side = (value: unknown): number | null | undefined => {
    if (value === "current") return null;
    if (typeof value !== "string" || !/^\d{1,6}$/.test(value)) return undefined;
    return Number(value);
  };
  const from = side(fromValue);
  const to = side(toValue);
  if (from === undefined || to === undefined || from === to) return null;
  return { from, to };
}
