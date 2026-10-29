import {z} from "zod";
const uuid=z.string().uuid(),q=z.number().finite().nonnegative(),page=z.number().int().min(1).max(10000).default(1);
export const cuttingRuleSchema=z.object({name:z.string().trim().min(3).max(80),saw_kerf_mm:q.max(50),trim_end_mm:q.max(100),cut_allowance_mm:q.max(100),min_remnant_mm:q.max(30000)}).strict();
export const cuttingCommandSchema=z.discriminatedUnion("command",[
  z.object({command:z.literal("lines.list"),order_id:uuid,page}).strict(),
  z.object({command:z.literal("rules.list"),page}).strict(),z.object({command:z.literal("rule.create"),id:uuid,rule:cuttingRuleSchema}).strict(),z.object({command:z.literal("rule.approve"),id:uuid}).strict(),
  z.object({command:z.literal("inputs.load"),order_item_id:uuid,rule_id:uuid,page}).strict(),
  z.object({command:z.literal("cut.record"),id:uuid,order_item_id:uuid,rule_id:uuid,batch_id:uuid,page,fingerprint:z.string().regex(/^[a-f0-9]{32}$/),cut_count:z.number().int().positive().max(5000),output_weight_kg:q.positive().max(1000000),remnant_mm:q.int().max(30000),remnant_weight_kg:q.max(1000000),waste_mm:q.max(30000),scrap_weight_kg:q.max(1000000)}).strict(),
]);
export const cuttingResultSchema=z.discriminatedUnion("kind",[
  z.object({kind:z.literal("lines"),page:z.number().int(),items:z.array(z.object({id:uuid,label:z.string()})).max(10)}).strict(),
  z.object({kind:z.literal("rules"),page:z.number().int(),items:z.array(z.object({id:uuid,name:z.string(),status:z.enum(["draft","approved"]),version:z.number().int(),created_by:uuid,rule:cuttingRuleSchema}).strict()).max(10)}).strict(),
  z.object({kind:z.literal("inputs"),order_item_id:uuid,cut_length_mm:q.positive(),remaining_pieces:q.int(),rule_id:uuid,rule:cuttingRuleSchema,page:z.number().int(),stock:z.array(z.object({id:uuid,bundle_number:z.string().nullable(),location:z.string().nullable(),stock_length_mm:q.positive(),bar_weight_kg:q.positive(),available_bars:q.int(),fingerprint:z.string().regex(/^[a-f0-9]{32}$/)}).strict()).max(10)}).strict(),
  z.object({kind:z.literal("saved"),id:uuid,replayed:z.boolean().optional(),output_batch_id:uuid.nullable().optional(),remnant_batch_id:uuid.nullable().optional()}).strict(),
]);
export type CuttingResult=z.infer<typeof cuttingResultSchema>;
export function planCuttingRequirements(input:{stockLengthMm:number;availableBars:number;cutLengthMm:number;requiredPieces:number;rule:z.infer<typeof cuttingRuleSchema>}){
  const rule=cuttingRuleSchema.parse(input.rule);
  if(![input.stockLengthMm,input.cutLengthMm].every(v=>Number.isFinite(v)&&v>0)||!Number.isSafeInteger(input.availableBars)||input.availableBars<0||!Number.isSafeInteger(input.requiredPieces)||input.requiredPieces<0||input.requiredPieces>5000)throw new Error("Capture bounded stock lengths and required whole pieces.");
  const cutUse=input.cutLengthMm+rule.saw_kerf_mm+rule.cut_allowance_mm;
  const perBar=Math.floor((input.stockLengthMm-2*rule.trim_end_mm+0.0000001)/cutUse);
  if(perBar<=0)return {bars:[],unplacedPieces:input.requiredPieces,estimated:true as const};
  const bars:{number:number;cuts:number;usedMm:number;estimatedOffcutMm:number;estimatedReusableMm:number}[]=[];
  let remaining=input.requiredPieces;
  for(let n=0;n<Math.min(input.availableBars,5000)&&remaining>0;n++){
    const cuts=Math.min(remaining,perBar),usedMm=Math.round((cuts*cutUse+2*rule.trim_end_mm)*1000)/1000;
    const offcut=Math.round((input.stockLengthMm-usedMm)*1000)/1000;
    if(offcut<0)throw new Error("Cutting sequence exceeds stock length.");
    bars.push({number:n+1,cuts,usedMm,estimatedOffcutMm:offcut,estimatedReusableMm:offcut>=rule.min_remnant_mm?offcut:0});remaining-=cuts;
  }
  return {bars,unplacedPieces:remaining,estimated:true as const};
}
