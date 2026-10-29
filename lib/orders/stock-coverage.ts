import {z} from "zod";
export const orderStockCoverageSchema=z.object({order_id:z.string().uuid(),complete:z.literal(true),items:z.array(z.object({order_item_id:z.string().uuid(),covered_weight_kg:z.number().finite().nonnegative()}).strict()).max(500)}).strict()
  .refine(value=>new Set(value.items.map(row=>row.order_item_id)).size===value.items.length,{message:"Conflicting stock coverage rows"});
