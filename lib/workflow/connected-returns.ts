import {z} from "zod";
const uuid=z.string().uuid(),q=z.number().finite().positive().max(1000000),page=z.number().int().min(1).max(10000).default(1);
export const returnDisposition=z.enum(["rework","scrap","return_to_stock","scrap_sale","write_off"]);
export const connectedReturnSchema=z.discriminatedUnion("command",[
  z.object({command:z.literal("returns.list"),page,order_id:uuid.optional(),dispatch_id:uuid.optional()}).strict(),
  z.object({command:z.literal("sources.list"),dispatch_id:uuid,page}).strict(),
  z.object({command:z.literal("return.receive"),id:uuid,packing_list_item_id:uuid,received_kg:q,received_pieces:q.int(),received_metres:q,reason:z.string().trim().min(8).max(1000)}).strict(),
  z.object({command:z.literal("return.inspect"),id:uuid,disposition:returnDisposition,note:z.string().trim().min(8).max(1000)}).strict(),
  z.object({command:z.literal("return.dispose"),id:uuid}).strict(),
  z.object({command:z.literal("return.credit"),id:uuid}).strict(),
]);
export type ConnectedReturnInput=z.input<typeof connectedReturnSchema>;
export function returnObservationProblem(shipped:{kg:number;pieces:number;metres:number},received:{kg:number;pieces:number;metres:number}){
  if(!Object.values(shipped).every(v=>Number.isFinite(v)&&v>0)||!Object.values(received).every(v=>Number.isFinite(v)&&v>0)||!Number.isInteger(received.pieces))return "Record finite positive observations and whole pieces.";
  if(received.kg>shipped.kg+0.001||received.pieces>shipped.pieces||received.metres>shipped.metres+0.001)return "The return exceeds its original shipment.";
  return null;
}
