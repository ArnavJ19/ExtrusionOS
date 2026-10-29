import { z } from "zod";
const uuid=z.string().uuid(),page=z.number().int().min(1).max(10000).default(1),q=z.number().finite().nonnegative();
export const stockProductionCommandSchema=z.discriminatedUnion("command",[
  z.object({command:z.literal("lines.list"),order_id:uuid,page}).strict(),z.object({command:z.literal("line.plan"),order_item_id:uuid,page}).strict(),
  z.object({command:z.literal("stock.allocate"),id:uuid,order_item_id:uuid,batch_id:uuid,pieces:z.number().int().positive().max(1000000),fingerprint:z.string().regex(/^[a-f0-9]{32}$/),page}).strict(),
]);
export const stockProductionResultSchema=z.discriminatedUnion("kind",[
  z.object({kind:z.literal("lines"),page:z.number().int(),items:z.array(z.object({id:uuid,label:z.string()})).max(10)}).strict(),
  z.object({kind:z.literal("plan"),order_item_id:uuid,page:z.number().int(),quantities:z.object({demand_kg:q,stock_covered_kg:q,stock_physical_kg:q,stock_pieces:q,production_committed_kg:q}).strict(),remaining_to_plan_kg:q,manufacture_kg:q,demand_kg_per_piece:q,
    stock:z.array(z.object({id:uuid,bundle_number:z.string().nullable(),location:z.string().nullable(),available:z.object({weight_kg:q,length_m:q,pieces:q}).strict(),reason:z.string().nullable(),fingerprint:z.string().regex(/^[a-f0-9]{32}$/)}).strict()).max(10)}).strict(),
  z.object({kind:z.literal("allocated"),id:uuid,replayed:z.boolean()}).strict(),
]).refine(value=>value.kind!=="plan"||Math.abs(value.manufacture_kg-proposedManufacturingRequirement(value.quantities.demand_kg,value.quantities.stock_covered_kg))<=0.001,{message:"Manufacturing quantities do not reconcile."});
export type StockProductionResult=z.infer<typeof stockProductionResultSchema>;
export function proposedManufacturingRequirement(demandKg:number,committedStockKg:number){
  if(![demandKg,committedStockKg].every(v=>Number.isFinite(v)&&v>=0)||committedStockKg>demandKg)throw new Error("Stock and demand quantities must reconcile.");
  return Math.round((demandKg-committedStockKg)*1000)/1000;
}
