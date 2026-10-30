import {z} from "zod";
const uuid=z.string().uuid(),page=z.number().int().min(1).max(10000).default(1);
export const selfServiceSchema=z.discriminatedUnion("command",[
  z.object({command:z.literal("orders.list"),page,search:z.string().max(80).default("")}).strict(),
  z.object({command:z.literal("order.load"),order_id:uuid}).strict(),
  z.object({command:z.literal("responses.list"),order_id:uuid,page}).strict(),
  z.object({command:z.literal("response.submit"),id:uuid,order_id:uuid,response_type:z.enum(["delivery_details","service_request"]),version:z.string().regex(/^[a-f0-9]{32}$/),text:z.string().trim().min(8).max(2000)}).strict(),
]);
export type SelfServiceInput=z.input<typeof selfServiceSchema>;
const q=z.number().finite().nonnegative().nullable();
export const safePortalOrder=z.object({id:uuid,order_number:z.string().nullable(),order_date:z.string(),stage:z.string(),expected_dispatch_date:z.string().nullable(),delivery_address:z.string().nullable().optional(),delivery_basis:z.enum(["accepted_order","current_customer_master"]).optional(),lines:z.array(z.object({id:uuid,profile_code:z.string().nullable(),description:z.string().nullable(),quantity_kg:q,pieces:q,length_per_piece_m:q}).strict()).max(100),shipments:z.array(z.object({id:uuid,dispatch_number:z.string().nullable(),dispatch_date:z.string().nullable(),delivery_status:z.string(),weight_kg:q,departed_at:z.string().nullable()}).strict()).max(100)}).strict();
export type SafePortalOrder=z.infer<typeof safePortalOrder>;
export function portalOrderDocument(input:unknown,version:string){const o=safePortalOrder.parse(input);if(!/^[a-f0-9]{32}$/.test(version))throw Error("Invalid document version");return [`Order summary: ${o.order_number??o.id}`,`Version: ${version}`,`Date: ${o.order_date}`,`Progress: ${o.stage}`,`Expected dispatch: ${o.expected_dispatch_date??"Not captured"}`,`Delivery address: ${o.delivery_address??"Not captured"}`,`Address source: ${o.delivery_basis==="accepted_order"?"Accepted order snapshot":"Current customer master; requires review"}`,"",...o.lines.map(l=>`${l.profile_code??"Profile"}: ${l.description??""}; ${l.quantity_kg??"Not captured"} kg; ${l.pieces??"Not captured"} pieces; ${l.length_per_piece_m??"Not captured"} m/piece`),"",...o.shipments.map(s=>`${s.dispatch_number??"Shipment"}: ${s.delivery_status}; ${s.weight_kg??"Not captured"} kg; departed ${s.departed_at??"Not recorded"}`),"","Customer responses require internal review. This summary does not change a dispatch or invoice."].join("\n");}
