import { z } from "zod";
const quantity=z.number().finite().nonnegative();
export const partialProgressSchema=z.object({order_id:z.string().uuid(),page:z.number().int().positive(),total:z.number().int().nonnegative(),unlinked_packing_rows:z.number().int().nonnegative(),basis:z.string(),items:z.array(z.object({id:z.string().uuid(),profile_id:z.string().uuid().nullable(),label:z.string(),ordered_kg:quantity.nullable(),ordered_pieces:quantity.nullable(),ordered_metres:quantity.nullable(),produced_kg:quantity,planned_open_kg:quantity,packed_pieces:quantity,packed_metres:quantity,packed_actual_kg:quantity,dispatched_actual_kg:quantity,remaining_to_pack_order_kg:quantity.nullable(),billed_kg:quantity.optional(),unbilled_packed_kg:quantity.nullable()}).strict()).max(10)}).strict();
export type PartialProgress=z.infer<typeof partialProgressSchema>;
export function remainingOrderBasis(orderedKg:number,orderedPieces:number,packedPieces:number){
  if(![orderedKg,orderedPieces,packedPieces].every(Number.isFinite)||orderedKg<=0||orderedPieces<=0||packedPieces<0||packedPieces>orderedPieces)return null;
  return Math.round((orderedKg-orderedKg*packedPieces/orderedPieces)*1000)/1000;
}
