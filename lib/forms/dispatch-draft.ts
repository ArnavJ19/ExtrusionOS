import { z } from "zod";

const field = z.string().max(1000);
export const dispatchDraftSchema = z.object({
  orderId: z.string().uuid(), dispatchDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  transporterName: field, vehicleNumber: field, driverName: field, driverPhone: field,
  ewayBillNumber: field, lrNumber: field, remarks: z.string().max(4000),
  bundles: z.array(z.object({
    key: z.string().uuid(), bundle_number: field, source_line_id: z.union([z.literal(""), z.string().uuid()]),
    number_of_pieces: field, net_length_m: field, gross_weight_kg: field, tare_weight_kg: field,
  }).strict()).min(1).max(200),
}).strict();
export type DispatchDraft = z.infer<typeof dispatchDraftSchema>;
export type DraftScope = { companyId: string; userId: string };
export const DRAFT_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const envelopeSchema = z.object({
  version: z.literal(1), id: z.string().uuid(), revision: z.string().uuid(),
  companyId: z.string().uuid(), userId: z.string().uuid(), savedAt: z.number().finite(),
  payload: dispatchDraftSchema,
}).strict();
export type DispatchDraftEnvelope = z.infer<typeof envelopeSchema>;
export function dispatchDraftKey(scope: DraftScope) {
  z.string().uuid().parse(scope.companyId); z.string().uuid().parse(scope.userId);
  return `eos:dispatch-draft:v1:${scope.companyId}:${scope.userId}`;
}
export function readDispatchDraft(raw: string | null, scope: DraftScope, now = Date.now()): DispatchDraftEnvelope | null {
  try {
    if (!raw || raw.length > 500_000) return null;
    const value = envelopeSchema.parse(JSON.parse(raw));
    if (value.companyId !== scope.companyId || value.userId !== scope.userId
      || value.savedAt > now + 60_000 || now - value.savedAt >= DRAFT_LIFETIME_MS) return null;
    return value;
  } catch { return null; }
}
export function nextDispatchDraft(scope: DraftScope, payload: unknown, previous: DispatchDraftEnvelope | null,
  id: string, revision: string, now = Date.now()): DispatchDraftEnvelope {
  return envelopeSchema.parse({ ...scope, version: 1, id: previous?.id ?? id, revision, savedAt: now, payload });
}
export function draftRevisionMatches(raw: string | null, expected: string | null) {
  if (raw === null) return expected === null;
  try { return envelopeSchema.parse(JSON.parse(raw)).revision === expected; } catch { return false; }
}
