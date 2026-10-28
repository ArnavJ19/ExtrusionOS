import { z } from "zod";
const uuid=z.string().uuid(), hash=z.string().regex(/^[a-f0-9]{32}$/);
export const partyOverridesSchema=z.object({delivery_address:z.string().trim().max(1000).optional(),payment_terms:z.string().trim().max(1000).optional(),contact_name:z.string().trim().max(120).optional(),contact_phone:z.string().trim().max(30).optional(),instructions:z.string().trim().max(1000).optional()}).strict();
export const quotePartyCommandSchema=z.discriminatedUnion("command",[
  z.object({command:z.literal("party.load"),quote_id:uuid}).strict(),
  z.object({command:z.literal("party.preview"),quote_id:uuid,project_id:uuid.nullable(),overrides:partyOverridesSchema}).strict(),
  z.object({command:z.literal("party.save"),quote_id:uuid,project_id:uuid.nullable(),overrides:partyOverridesSchema,source_fingerprint:hash,quote_fingerprint:hash}).strict(),
  z.object({command:z.literal("sites.list"),quote_id:uuid,page:z.number().int().min(1).max(10000).default(1),search:z.string().trim().max(80).default("")}).strict()
]);
export const partyViewSchema=z.object({party:z.object({customer_id:uuid,customer_name:z.string(),gst_number:z.string().nullable(),billing_address:z.string().nullable(),delivery_address:z.string().nullable(),payment_terms:z.string().nullable(),contact_name:z.string().nullable(),contact_phone:z.string().nullable(),site_name:z.string().nullable(),project_id:uuid.nullable(),instructions:z.string().nullable(),precedence:z.string()}).strict().nullable(),immutable:z.boolean(),captured:z.boolean(),quote_fingerprint:hash,source_fingerprint:hash.optional(),project_id:uuid.nullable().optional(),overrides:partyOverridesSchema.optional()}).strict();
export type PartyView=z.infer<typeof partyViewSchema>;
export const partySitesSchema=z.object({page:z.number().int(),items:z.array(z.object({id:uuid,name:z.string(),site_name:z.string().nullable(),site_address:z.string().nullable()}).strict())}).strict();
