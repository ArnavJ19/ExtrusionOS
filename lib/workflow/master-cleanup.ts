import { z } from "zod";
const uuid = z.string().uuid();
export const masterEntitySchema = z.enum(["customers", "vendors", "aluminium_profiles"]);
const page = z.number().int().min(1).max(10000).default(1);
export const masterCleanupSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("duplicates.list"), entity_type: masterEntitySchema, search: z.string().max(80).default(""), page }).strict(),
  z.object({ command: z.literal("masters.list"), entity_type: masterEntitySchema, search: z.string().max(80).default(""), page }).strict(),
  z.object({ command: z.literal("reviews.list"), page }).strict(),
  z.object({ command: z.literal("review.preview"), entity_type: masterEntitySchema, source_id: uuid, target_id: uuid }).strict(),
  z.object({ command: z.literal("review.propose"), entity_type: masterEntitySchema, source_id: uuid, target_id: uuid, id: uuid, fingerprint: z.string().regex(/^[a-f0-9]{32}$/), reason: z.string().trim().min(8).max(1000) }).strict(),
  z.object({ command: z.literal("review.approve"), entity_type: masterEntitySchema, id: uuid }).strict(),
]);
export type MasterCleanupInput = z.input<typeof masterCleanupSchema>;
export type MasterComparison = { source: Record<string, unknown>; target: Record<string, unknown>; fingerprint: string; history_policy: string; dependencies?: Record<string,number> };
