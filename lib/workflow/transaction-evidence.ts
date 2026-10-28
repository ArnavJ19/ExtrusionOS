import {z} from "zod";
const uuid=z.string().uuid(),num=z.number().finite();
export const materialSuggestionInputSchema=z.object({profile_id:uuid,technical_option_id:uuid.nullable().optional(),finish:z.string().min(1).max(60),cut_length_m:z.number().positive().max(1000),customer_id:uuid.nullable().optional(),page:z.number().int().min(1).max(10000).default(1)}).strict();
export const materialSuggestionsSchema=z.object({profile_id:uuid,page:z.number().int(),calculated_at:z.string(),basis:z.string(),
  stock:z.array(z.object({id:uuid,bundle_number:z.string().nullable(),location:z.string().nullable(),finish:z.string(),piece_length_m:num.nullable(),updated_at:z.string(),reason:z.string().nullable(),eligible:z.boolean(),
    available:z.object({weight_kg:num,pieces:num,length_m:num}).strict(),reserved:z.object({weight_kg:num,pieces:num,length_m:num,count:num}).strict(),fingerprint:z.string()}).strict()),
  dies:z.array(z.object({id:uuid,die_number:z.string(),rack_location:z.string().nullable(),die_status:z.string(),reason:z.string().nullable()}).strict())}).strict();
export type MaterialSuggestions=z.infer<typeof materialSuggestionsSchema>;
export const transactionProgressSchema=z.object({order_id:uuid,order_number:z.string(),calculated_at:z.string(),produced_kg:num.nullable(),production_evidence_complete:z.boolean(),confirmed_outward_kg:num.nullable(),dispatch_evidence_complete:z.boolean(),recorded_returns_kg:num,net_outward_kg:num.nullable(),quality_exceptions:z.number().int().nonnegative(),current_stage:z.string(),basis:z.string(),financials:z.object({billed:num,receipts_net:num,credits:num,receivable:num,customer_credit_due:num,invoice_count:num}).strict().optional()}).strict();
export type TransactionProgress=z.infer<typeof transactionProgressSchema>;
export function evidenceQuantity(value:number|null){return value===null?"Unavailable evidence":`${value.toLocaleString("en-IN",{maximumFractionDigits:3})} kg`;}
