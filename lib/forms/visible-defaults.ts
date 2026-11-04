// NOV-008: visible, explainable defaults. A default is a labelled suggestion, never a silent value.
// Precedence: the source record (order, job, quote) > customer or site > company > personal > system date.
// A deliberate override is kept when a lower-precedence default arrives later. Physical measurements,
// prices and approvals are never defaulted.
import type { FieldProvenance } from "@/lib/ui/form-workflow";

export type DefaultTier = "source" | "customer" | "company" | "personal" | "system";
export const DEFAULT_TIER_RANK: Record<DefaultTier, number> = { source: 0, customer: 1, company: 2, personal: 3, system: 4 };

/** Personal defaults the server accepts (public.form_defaults_command), by module and field. */
export type PersonalDefaultKey = "production.machine_id" | "production.shift" | "dispatches.transporter_name";
export const PERSONAL_DEFAULT_KEYS: Record<string, Record<string, PersonalDefaultKey>> = {
  production: { machine_id: "production.machine_id", shift: "production.shift" },
  dispatches: { transporter_name: "dispatches.transporter_name" }
};

export function personalDefaultKey(moduleKey: string, field: string): PersonalDefaultKey | null {
  return PERSONAL_DEFAULT_KEYS[moduleKey]?.[field] ?? null;
}
export function personalDefaultKeys(moduleKey: string): PersonalDefaultKey[] {
  return Object.values(PERSONAL_DEFAULT_KEYS[moduleKey] ?? {});
}

// Weights, lengths, quantities, rates, amounts and approval or QC outcomes are always entered deliberately.
const PROTECTED = /(weight|_kg$|kg_|length|_mm$|_m$|quantity|pieces|price|rate|amount|total|cost|margin|discount|gst|tax|approv|status$|result|outcome|hardness|thickness)/i;
export function isDefaultableField(name: string) {
  return !PROTECTED.test(name);
}

export type DefaultCandidate = { tier: DefaultTier; value: unknown; sourceId: string; label: string };
const blank = (value: unknown) => value === undefined || value === null || String(value).trim() === "";

/** The highest-precedence usable candidate, or null. Blank values never win. */
export function resolveVisibleDefault(field: string, candidates: DefaultCandidate[]) {
  if (!isDefaultableField(field)) return null;
  return [...candidates].filter(candidate => !blank(candidate.value)).sort((a, b) => DEFAULT_TIER_RANK[a.tier] - DEFAULT_TIER_RANK[b.tier])[0] ?? null;
}

const LABELS: Record<DefaultTier, string> = { source: "Copied from", customer: "Suggested for this customer:", company: "Company default:", personal: "Your usual", system: "Suggested:" };
export function defaultOriginText(tier: DefaultTier, label: string) {
  return `${LABELS[tier]} ${label}`;
}

/**
 * Applies a default tier to the form. A field keeps its value when it was set by a higher-precedence
 * tier, when the user deliberately overrode it, or when it already holds a value the user typed.
 * `compatible` lets the caller drop a value the field can no longer accept (for example an inactive press).
 */
export function applyVisibleDefaults(current: Record<string, unknown>, provenance: Record<string, FieldProvenance>, tier: DefaultTier,
  defaults: Record<string, unknown>, source: { id: string; label: string }, refreshedAt: string, compatible: (field: string, value: unknown) => boolean = () => true) {
  const values = { ...current };
  const next = { ...provenance };
  for (const [field, value] of Object.entries(defaults)) {
    if (blank(value) || !isDefaultableField(field) || !compatible(field, value)) continue;
    const previous = provenance[field];
    const previousTier = previous ? tierOf(previous) : null;
    if (previous?.overridden) continue;
    if (previousTier && DEFAULT_TIER_RANK[previousTier] < DEFAULT_TIER_RANK[tier]) continue;
    if (!previous && !blank(current[field])) continue;
    values[field] = value;
    next[field] = { kind: "default", tier, sourceId: source.id, sourceLabel: source.label, refreshedAt, suggested: value, overridden: false };
  }
  return { values, provenance: next };
}

export function tierOf(provenance: FieldProvenance): DefaultTier {
  return provenance.kind === "default" ? provenance.tier ?? "system" : "source";
}

/** System date suggestions for a new record: today's business date (IST) for date fields that the module pre-fills. */
export function systemDateDefaults(fields: { name: string; type?: string }[], configured: Record<string, unknown>, today: string) {
  return Object.fromEntries(fields.filter(field => field.type === "date" && !blank(configured[field.name]) && isDefaultableField(field.name)).map(field => [field.name, today]));
}
