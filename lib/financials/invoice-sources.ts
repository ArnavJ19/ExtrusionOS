import {z} from "zod";
import type {SupabaseClient} from "@supabase/supabase-js";

export const retainedShipmentStatuses = ["dispatched","in_transit","delivered"] as const;
export function canInvoiceOrderDispatch(orderStage: string, dispatchStatus: string) {
  return orderStage !== "cancelled" || (retainedShipmentStatuses as readonly string[]).includes(dispatchStatus);
}

export const invoiceSourceRequest = z.object({
  kind: z.enum(["order","dispatch"]), search: z.string().max(100).default(""),
  orderId: z.string().uuid().nullable().optional(), invoiceId: z.string().uuid().nullable().optional(), selectedId: z.string().uuid().nullable().optional()
}).refine(value => value.kind !== "dispatch" || Boolean(value.orderId));
export type InvoiceSourceRequest = z.input<typeof invoiceSourceRequest>;
const order = z.object({id:z.string().uuid(),order_number:z.string().nullable(),customer_id:z.string().uuid(),current_stage:z.string().min(1),
  order_value:z.number().finite().nonnegative().nullable(),customer_name:z.string().nullable(),company_name:z.string().nullable()});
const dispatch = z.object({id:z.string().uuid(),order_id:z.string().uuid(),dispatch_number:z.string().nullable(),
  dispatch_date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),delivery_status:z.enum(["pending",...retainedShipmentStatuses]),
  total_weight_kg:z.number().finite().positive()});
const envelope = z.discriminatedUnion("kind",[
  z.object({kind:z.literal("order"),has_more:z.boolean(),rows:z.array(order).max(25)}),
  z.object({kind:z.literal("dispatch"),has_more:z.boolean(),rows:z.array(dispatch).max(25)})
]).refine(value => new Set(value.rows.map(row => row.id)).size === value.rows.length && (!value.has_more || value.rows.length === 25));
export type InvoiceOrderOption = z.infer<typeof order>;
export type InvoiceDispatchOption = z.infer<typeof dispatch>;
export type InvoiceSourceOptions = z.infer<typeof envelope>;

export async function loadInvoiceSourceOptions(client: Pick<SupabaseClient,"rpc">, input: InvoiceSourceRequest): Promise<InvoiceSourceOptions> {
  const request = invoiceSourceRequest.parse(input);
  const result = await client.rpc("get_invoice_source_options", {p_kind:request.kind,p_search:request.search.trim(),p_order_id:request.orderId??null,
    p_invoice_id:request.invoiceId??null,p_selected_id:request.selectedId??null});
  if(result.error) throw result.error;
  const parsed = envelope.safeParse(result.data);
  if(!parsed.success || parsed.data.kind !== request.kind
    || (request.selectedId && (parsed.data.has_more || parsed.data.rows.length > 1 || parsed.data.rows.some(row => row.id !== request.selectedId)))
    || (parsed.data.kind === "dispatch" && parsed.data.rows.some(row => row.order_id !== request.orderId))) {
    throw new Error("Invoice sources are unavailable or incomplete.");
  }
  return parsed.data;
}
