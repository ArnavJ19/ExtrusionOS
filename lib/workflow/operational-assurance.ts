import {z} from "zod";
const uuid=z.string().uuid(),page=z.number().int().min(1).max(10000).default(1),fingerprint=z.string().regex(/^[a-f0-9]{32}$/),sourceType=z.enum(["dispatch","invoice"]);
export const operationalAssuranceSchema=z.discriminatedUnion("command",[
  z.object({command:z.literal("reviews.list"),page}).strict(),
  z.object({command:z.literal("review.resolve"),id:uuid,fingerprint,decision:z.enum(["accepted","repeat_required"]),note:z.string().trim().min(10).max(1000)}).strict(),
  z.object({command:z.literal("sources.list"),source_type:sourceType,search:z.string().max(80).default(""),page}).strict(),
  z.object({command:z.literal("boundary.enable"),source_type:sourceType}).strict(),
  z.object({command:z.literal("boundary.evaluate"),source_type:sourceType,source_id:uuid}).strict(),
  z.object({command:z.literal("boundary.record"),id:uuid,source_type:sourceType,source_id:uuid,fingerprint,decision:z.enum(["hold","reconciled"]),note:z.string().trim().min(8).max(1000)}).strict(),
]);
export type AssuranceInput=z.input<typeof operationalAssuranceSchema>;
export function boundaryCanReconcile(expected:unknown,recorded:unknown,complete:boolean,unit:"kg"|"INR"){
  return complete&&typeof expected==="number"&&typeof recorded==="number"&&Number.isFinite(expected)&&Number.isFinite(recorded)&&expected>=0&&recorded>=0&&Math.abs(expected-recorded)<=(unit==="kg"?0.001:0.01);
}
