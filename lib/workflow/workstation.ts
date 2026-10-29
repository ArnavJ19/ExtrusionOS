import { z } from "zod";
const uuid=z.string().uuid();
export const workstationCommandSchema=z.discriminatedUnion("command",[
  z.object({command:z.literal("stations.list"),page:z.number().int().min(1).max(10000).default(1),search:z.string().trim().max(80).default("")}).strict(),
  z.object({command:z.literal("station.open"),id:uuid,machine_id:uuid}).strict(),
  z.object({command:z.literal("station.queue"),id:uuid}).strict(),z.object({command:z.literal("station.end"),id:uuid}).strict(),
]);
export const workstationResultSchema=z.discriminatedUnion("kind",[
  z.object({kind:z.literal("stations"),page:z.number().int(),items:z.array(z.object({id:uuid,name:z.string(),machine_type:z.string()}).strict()).max(10)}).strict(),
  z.object({kind:z.literal("session"),id:uuid,machine_id:uuid,name:z.string(),expires_at:z.string().datetime({offset:true}),operator_id:uuid}).strict(),
  z.object({kind:z.literal("queue"),items:z.array(z.object({id:uuid,job_number:z.string(),status:z.string(),order_id:uuid.nullable(),profile_id:uuid.nullable(),planned_quantity_kg:z.number().finite().nonnegative().nullable()}).strict()).max(10),expires_at:z.string().datetime({offset:true})}).strict(),
  z.object({kind:z.literal("ended")}).strict(),
]);
export type WorkstationResult=z.infer<typeof workstationResultSchema>;
export function stationPreferenceKey(companyId:string){uuid.parse(companyId);return `eos:workstation:${companyId}`;}
export function workstationExpired(expiresAt:string,now=Date.now()){return !Number.isFinite(Date.parse(expiresAt))||Date.parse(expiresAt)<=now;}
