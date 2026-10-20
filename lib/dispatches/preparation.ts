import {z} from "zod";
import {buildVerifiedPackingListItems} from "@/lib/pcda/dispatch";

const orderRow=z.object({id:z.string().uuid(),order_number:z.string().nullable(),customer_name:z.string().nullable().optional(),company_name:z.string().nullable().optional()});
export function readDispatchOrderOptions(data:unknown){
  const rows=z.array(orderRow).max(50).parse(data);
  if(new Set(rows.map(row=>row.id)).size!==rows.length)throw new Error("Conflicting order choices");
  return rows.map(row=>({value:row.id,label:`${row.order_number||"Order"} - ${row.company_name||row.customer_name||"Customer"}`}));
}
const source=z.object({id:z.string().uuid(),sourceKind:z.enum(["reservation","dealer_stock","production"]),sourceLabel:z.string().min(1),
  profileId:z.string().uuid(),profileLabel:z.string().min(1),stockBatchId:z.string().uuid().nullable(),stockBatchLabel:z.string().nullable(),
  availableWeightKg:z.number().finite().positive(),availablePieces:z.number().int().nonnegative().safe(),availableLengthM:z.number().finite().nonnegative()});
export type DispatchPreparationSource=z.infer<typeof source>;
export function readDispatchPreparationSources(data:unknown){
  const parsed=z.object({success:z.literal(true),sources:z.array(source)}).parse(data);
  if(new Set(parsed.sources.map(row=>row.id)).size!==parsed.sources.length)throw new Error("Conflicting material sources");
  if(parsed.sources.some(row=>row.sourceKind==="reservation"&&!row.stockBatchId))throw new Error("Reserved material lacks its stock batch");
  return parsed.sources;
}
export type DispatchBundleDraft={bundle_number:string;source_line_id:string;number_of_pieces:string;net_length_m:string;gross_weight_kg:string;tare_weight_kg:string};

export function readDispatchManifest(sources:DispatchPreparationSource[],companyId:string,orderId:string,rows:DispatchBundleDraft[]){
  const bundles=rows.map(row=>({bundle_number:row.bundle_number,source_line_id:row.source_line_id,number_of_pieces:Number(row.number_of_pieces),
    net_length_m:Number(row.net_length_m),gross_weight_kg:Number(row.gross_weight_kg),tare_weight_kg:Number(row.tare_weight_kg)}));
  // Reuse the server's quantity/source checks; the server still reloads its authoritative sources.
  buildVerifiedPackingListItems(sources.map(row=>({id:row.id,source_kind:row.sourceKind,profile_id:row.profileId,profile_stock_batch_id:row.stockBatchId,
    order_id:orderId,available_weight_kg:row.availableWeightKg,available_pieces:row.availablePieces,available_length_m:row.availableLengthM})),companyId,bundles);
  return bundles;
}
