import { z } from "zod";
const uuid=z.string().uuid(), quantity=z.number().finite().positive().max(1000000).multipleOf(0.001);
export const physicalBundleObservationSchema=z.object({
  id:uuid,order_id:uuid,source_line_id:uuid,bundle_number:z.string().trim().min(1).max(80),
  number_of_pieces:z.number().int().positive().max(1000000),net_length_m:quantity,
  gross_weight_kg:quantity,tare_weight_kg:z.number().finite().nonnegative().max(1000000).multipleOf(0.001),
}).strict().refine(v=>v.gross_weight_kg>v.tare_weight_kg,{message:"Gross weight must exceed tare weight."});
export const physicalBundleListRequest=z.object({order_id:uuid,page:z.number().int().min(1).max(10000).default(1),search:z.string().trim().max(80).default("")}).strict();
export const physicalBundleListSchema=z.object({page:z.number().int().positive(),items:z.array(z.object({id:uuid,bundle_number:z.string(),source_line_id:uuid,
  number_of_pieces:z.number().int().positive(),net_length_m:quantity,gross_weight_kg:quantity,tare_weight_kg:z.number().finite().nonnegative(),net_weight_kg:quantity}).strict()).max(10)}).strict();
export function physicalBundleTag(date: string,id: string){
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(date);uuid.parse(id);
  return `B-${date.replaceAll("-","")}-${id.toUpperCase()}`;
}
export type PhysicalBundle = z.infer<typeof physicalBundleListSchema>["items"][number];
