import {z} from "zod";
const uuid=z.string().uuid(),q=z.number().finite().nonnegative().max(1000000000),page=z.number().int().min(1).max(10000).default(1);
export const machineUsageCommandSchema=z.discriminatedUnion("command",[
  z.object({command:z.literal("machines.list"),page}).strict(),
  z.object({command:z.literal("meters.list"),page}).strict(),
  z.object({command:z.literal("meter.create"),id:uuid,machine_id:uuid,name:z.string().trim().min(3).max(80),counter_modulus:q.positive().nullable()}).strict(),
  z.object({command:z.literal("tariff.create"),id:uuid,meter_id:uuid,effective_from:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),rate_per_kwh:q.max(1000000)}).strict(),
  z.object({command:z.literal("tariff.approve"),id:uuid}).strict(),
  z.object({command:z.literal("usage.load"),meter_id:uuid}).strict(),
  z.object({command:z.literal("usage.start"),id:uuid,meter_id:uuid,opening_reading:q}).strict(),
  z.object({command:z.literal("usage.pause"),id:uuid,run_id:uuid}).strict(),z.object({command:z.literal("usage.resume"),id:uuid,run_id:uuid}).strict(),
  z.object({command:z.literal("usage.stop"),id:uuid,run_id:uuid,closing_reading:q}).strict(),
  z.object({command:z.literal("usage.resolve"),id:uuid,run_id:uuid,closing_reading:q,rollovers:z.number().int().min(0).max(1),reason:z.string().trim().min(8).max(1000)}).strict(),
]);
export const machineUsageResultSchema=z.discriminatedUnion("kind",[
  z.object({kind:z.literal("machines"),page:z.number().int(),items:z.array(z.object({id:uuid,name:z.string()}).strict()).max(10)}).strict(),
  z.object({kind:z.literal("meters"),page:z.number().int(),items:z.array(z.object({id:uuid,name:z.string(),machine_id:uuid,machine_name:z.string(),counter_modulus:q.nullable()}).strict()).max(10),tariffs:z.array(z.object({id:uuid,meter_id:uuid,effective_from:z.string(),status:z.string(),created_by:uuid,rate_per_kwh:q}).strict()).max(10).optional()}).strict(),
  z.object({kind:z.literal("state"),run:z.object({id:uuid,meter_id:uuid,status:z.enum(["running","paused","requires_review","closed"]),operator_id:uuid,started_at:z.string(),stopped_at:z.string().nullable(),opening_reading:q,closing_reading:q.nullable(),runtime_seconds:q.nullable(),downtime_seconds:q.nullable(),energy_used:q.nullable(),cost:z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable().optional(),review_reason:z.string().nullable(),allocation_basis:z.literal("Machine total; no job allocation"),events:z.array(z.object({id:uuid,command:z.string(),at:z.string(),reading:q.nullable(),reason:z.string().nullable()}).strict()).max(10).optional()}).strict().nullable()}).strict(),
  z.object({kind:z.literal("saved"),id:uuid,replayed:z.boolean().optional()}).strict(),
]);
export type MachineUsageResult=z.infer<typeof machineUsageResultSchema>;
export function measuredEnergy(opening:number,closing:number,modulus:number|null,verifiedRollovers=0){
  if(![opening,closing].every(v=>Number.isFinite(v)&&v>=0)||![0,1].includes(verifiedRollovers))return {ok:false as const,reason:"Capture valid meter observations."};
  if(verifiedRollovers===1){if(!modulus||!Number.isFinite(modulus)||opening>=modulus||closing>=modulus||closing>=opening)return {ok:false as const,reason:"A verified single rollover and configured counter modulus are required."};return {ok:true as const,kwh:modulus-opening+closing};}
  return closing>=opening?{ok:true as const,kwh:closing-opening}:{ok:false as const,reason:"Reading decreased. Independent resolution is required."};
}
