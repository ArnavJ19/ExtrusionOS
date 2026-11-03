// November NOV-013: dependable device drafts for lengthy operational forms. A draft preserves
// typed entries only; it never issues stock, approves quality or posts money. The dispatch form
// keeps its specialised draft (lib/forms/dispatch-draft.ts); this generalises the same lifecycle.
import { z } from "zod";

export type DraftScope = { companyId: string; userId: string };
export type DraftValue = string | number | boolean;
export type DraftDefinition = { workflow: string; schemaVersion: number; lifetimeMs: number; fields: readonly string[] };

/**
 * New-record forms that may keep a device draft. Financial and commercial forms are excluded.
 * Production planning is excluded: its order-line autofill and billet selection must be derived
 * again from live sources rather than replayed from a device copy.
 */
export const DRAFT_MODULES = ["quality", "packaging", "machines"] as const;
export const DRAFT_SCHEMA_VERSION = 1;
export const FORM_DRAFT_LIFETIME_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_DRAFT_BYTES = 200_000;
// Rates, prices and payment values are not written to device storage even when a form shows them.
const SENSITIVE_FIELD = /(rate|price|amount|cost|value|margin|payment|bank|gst|tax)/i;

export const isSensitiveDraftField = (name: string) => SENSITIVE_FIELD.test(name);
export const isDraftModule = (moduleKey: string) => (DRAFT_MODULES as readonly string[]).includes(moduleKey);

export function draftDefinition(workflow: string, fields: readonly string[], schemaVersion = DRAFT_SCHEMA_VERSION): DraftDefinition {
  if (!/^[a-z][a-z0-9_]{1,40}$/.test(workflow)) throw new Error("Invalid draft workflow");
  return { workflow, schemaVersion, lifetimeMs: FORM_DRAFT_LIFETIME_MS, fields: fields.filter(name => !isSensitiveDraftField(name)) };
}

export function formDraftKey(definition: DraftDefinition, scope: DraftScope) {
  z.string().uuid().parse(scope.companyId); z.string().uuid().parse(scope.userId);
  return `eos:form-draft:${definition.workflow}:${scope.companyId}:${scope.userId}`;
}

/** Only declared, non-sensitive scalar fields are kept; everything else stays on the page only. */
export function draftPayload(definition: DraftDefinition, values: Record<string, unknown>) {
  const payload: Record<string, DraftValue> = {};
  for (const name of definition.fields) {
    const value = values[name];
    if (typeof value === "string" ? value.length <= 4000 : typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) payload[name] = value as DraftValue;
  }
  return payload;
}

const envelopeSchema = z.object({
  format: z.literal("eos-form-draft"), schemaVersion: z.number().int().positive(), workflow: z.string(), id: z.string().uuid(), revision: z.string().uuid(),
  companyId: z.string().uuid(), userId: z.string().uuid(), savedAt: z.number().finite(),
  payload: z.record(z.union([z.string().max(4000), z.number().finite(), z.boolean()]))
}).strict();
export type FormDraftEnvelope = z.infer<typeof envelopeSchema>;
export type DraftReadResult = { state: "none" } | { state: "available"; draft: FormDraftEnvelope } | { state: "discarded"; reason: "expired" | "other_scope" | "older_format" | "unreadable" };

export function readFormDraft(definition: DraftDefinition, raw: string | null, scope: DraftScope, now = Date.now()): DraftReadResult {
  if (raw === null) return { state: "none" };
  try {
    if (raw.length > MAX_DRAFT_BYTES) return { state: "discarded", reason: "unreadable" };
    const value = envelopeSchema.parse(JSON.parse(raw));
    if (value.companyId !== scope.companyId || value.userId !== scope.userId || value.workflow !== definition.workflow) return { state: "discarded", reason: "other_scope" };
    if (value.schemaVersion !== definition.schemaVersion) return { state: "discarded", reason: "older_format" };
    if (value.savedAt > now + 60_000 || now - value.savedAt >= definition.lifetimeMs) return { state: "discarded", reason: "expired" };
    // A draft cannot reintroduce a field this form no longer saves, including a sensitive one.
    const payload = draftPayload(definition, value.payload);
    return { state: "available", draft: { ...value, payload } };
  } catch { return { state: "discarded", reason: "unreadable" }; }
}

export function nextFormDraft(definition: DraftDefinition, scope: DraftScope, values: Record<string, unknown>, previous: FormDraftEnvelope | null, id: string, revision: string, now = Date.now()) {
  const envelope = envelopeSchema.parse({ format: "eos-form-draft", schemaVersion: definition.schemaVersion, workflow: definition.workflow, id: previous?.id ?? id, revision,
    companyId: scope.companyId, userId: scope.userId, savedAt: now, payload: draftPayload(definition, values) });
  if (JSON.stringify(envelope).length > MAX_DRAFT_BYTES) throw new Error("Draft is too large to keep on this device");
  return envelope;
}

/** Cross-tab protection: a write proceeds only when storage still holds the revision this tab last saw. */
export function formDraftRevisionMatches(raw: string | null, expected: string | null) {
  if (raw === null) return expected === null;
  try { return envelopeSchema.parse(JSON.parse(raw)).revision === expected; } catch { return false; }
}

export function samePayload(a: Record<string, DraftValue>, b: Record<string, DraftValue>) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
}

export const DISCARD_MESSAGES: Record<Exclude<DraftReadResult, { state: "none" | "available" }>["reason"], string> = {
  expired: "An earlier draft expired and was removed. Start the entry again.",
  other_scope: "A draft saved for another company or employee was not restored.",
  older_format: "An earlier draft used an older form layout and could not be restored safely.",
  unreadable: "An earlier draft could not be read and was removed."
};
