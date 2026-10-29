import { z } from "zod";
export const downstreamContextRequest = z.object({ order_id: z.string().uuid(), dispatch_id: z.string().uuid().optional() }).strict();
export const downstreamContextSchema = z.object({
  order_id: z.string().uuid(), order_number: z.string(), basis: z.string(), immutable: z.boolean(),
  party: z.object({ customer_name: z.string(), delivery_address: z.string().nullable(), contact_name: z.string().nullable(),
    contact_phone: z.string().nullable(), site_name: z.string().nullable(), instructions: z.string().nullable() }).strict(),
}).strict();
export type DownstreamContext = z.infer<typeof downstreamContextSchema>;
