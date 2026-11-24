// Order lifecycle orchestration Phase 4 (migration 20261123100000): QC reversal. An approval that turned out wrong is
// marked reversed and its kilograms move to rejected (or rework) child records; any part kept stays approved. The
// database enforces every rule (who may reverse, how much has already moved on, the containment state); this module
// validates requests and response shapes.
import { z } from "zod";

const uuid = z.string().uuid();
const noControl = (value: string) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const text = (min: number, max: number, message: string) => z.string().trim().min(min, message).max(max).refine(noControl, "Remove control characters");

export const QC_REVERSERS = ["owner", "quality"];
export const canReverseQc = (role: string) => QC_REVERSERS.includes(role);

export const reversalCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("list"), page: z.number().int().min(1).max(100000).optional(), job_id: uuid.optional(), order_id: uuid.optional() }).strict(),
  z.object({ command: z.literal("get"), id: uuid }).strict(),
  z.object({ command: z.literal("preview"), inspection_id: uuid }).strict(),
  z.object({
    command: z.literal("reverse"), inspection_id: uuid, reversed_kg: z.number().positive("Record the kilograms to reverse (more than 0)").max(10_000_000),
    reversed_as: z.enum(["rejected", "rework"]), method: text(2, 120, "Record how the material was re-checked"),
    reason: text(10, 500, "Record why the approval is reversed (at least 10 characters)"),
    reference: z.string().trim().min(2, "The reference must be at least 2 characters").max(80).refine(noControl, "Remove control characters").optional()
  }).strict()
]);
export type ReversalCommand = z.input<typeof reversalCommandSchema>;
export const REVERSAL_MUTATIONS = new Set(["reverse"]);

const kg = z.coerce.number();
export const reversalPreviewSchema = z.object({
  inspection_id: z.string(), status: z.string(), batch_number: z.string().nullable(), quantity_kg: kg, inspection_date: z.string().nullable(), inspector_name: z.string().nullable(),
  stage: z.enum(["production", "after_finishing"]), job_id: z.string().nullable(), job_number: z.string().nullable(), order_id: z.string().nullable(), order_number: z.string().nullable(),
  profile_code: z.string().nullable(), job_approved_kg: kg, moved_on_kg: kg, max_reversible_kg: kg,
  containment: z.object({ id: z.string(), containment_number: z.string(), review_id: z.string().nullable(), review_outcome: z.string().nullable(), review_closed: z.boolean() }).nullable(),
  reversal_id: z.string().nullable(), can_reverse: z.boolean(), blocker: z.string().nullable()
}).passthrough();
export type ReversalPreview = z.infer<typeof reversalPreviewSchema>;

export const reversalSchema = z.object({
  id: z.string(), reversal_number: z.string(), inspection_id: z.string(), batch_number: z.string().nullable(), inspection_date: z.string().nullable(), inspector_name: z.string().nullable(),
  stage: z.string(), job_id: z.string(), job_number: z.string().nullable(), order_id: z.string().nullable(), order_number: z.string().nullable(), profile_code: z.string().nullable(),
  original_kg: kg, reversed_kg: kg, retained_kg: kg, reversed_as: z.enum(["rejected", "rework"]), method: z.string(), reason: z.string(), reference: z.string().nullable(),
  job_approved_kg: kg, moved_on_kg: kg, containment_id: z.string().nullable(), containment_number: z.string().nullable(), revocation_closed: z.boolean(),
  reversed_inspection_id: z.string(), retained_inspection_id: z.string().nullable(), reversed_by_name: z.string().nullable(), reversed_at: z.string()
}).passthrough();
export type Reversal = z.infer<typeof reversalSchema>;
export const reversalListSchema = z.object({ page: z.number(), page_size: z.number(), total: z.number(), can_reverse: z.boolean(), rows: z.array(reversalSchema) });

/** Largest quantity the form may offer: the database rechecks it under a lock. */
export function reversibleKg(preview: Pick<ReversalPreview, "quantity_kg" | "max_reversible_kg">): number {
  return Math.max(0, Math.min(preview.quantity_kg, preview.max_reversible_kg));
}
