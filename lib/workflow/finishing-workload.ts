import type {SupabaseClient} from '@supabase/supabase-js';
import {z} from 'zod';

export const finishingStatuses=['planned','sent_to_vendor','in_process','received','completed','rejected','not_required'] as const;
export const finishingAttentionStatuses=['planned','sent_to_vendor','in_process','received','rejected'] as const;
export const finishingSorts=['planned_date','created_at','order_number','status','input_weight_kg','output_weight_kg','rejection_weight_kg'] as const;
const uuid=z.string().uuid().transform(value=>value.toLowerCase());
const count=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const quantity=(signed=false)=>z.union([z.number(),z.string()]).superRefine((value,context)=>{
  const text=String(value).trim(),pattern=signed?/^-?\d+(\.\d{1,3})?$/:/^\d+(\.\d{1,3})?$/;
  if(!pattern.test(text)||!Number.isFinite(Number(text))||!Number.isSafeInteger(Math.round(Number(text)*1000)))context.addIssue({code:z.ZodIssueCode.custom,message:'Invalid finishing quantity'});
}).transform(Number);
const kg=quantity();
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value).nullable();
const retrySchema=z.object({id:uuid,status:z.enum(finishingStatuses),input_weight_kg:kg});
const rowSchema=z.object({id:uuid,company_id:uuid,order_id:uuid,production_job_id:uuid,finishing_type:z.string().min(1),status:z.enum(finishingStatuses),
  color_code:z.string().nullable(),shade_name:z.string().nullable(),vendor_id:uuid.nullable(),planned_date:date,sent_date:date,received_date:date,
  created_at:z.string().datetime({offset:true}),updated_at:z.string().datetime({offset:true}),input_weight_kg:kg,output_weight_kg:kg.nullable(),rejection_weight_kg:kg.nullable(),
  remaining_rejected_kg:kg,retry_of_finishing_job_id:uuid.nullable(),corrective_retry:retrySchema.nullable(),can_retry:z.boolean(),remarks:z.string().nullable(),
  order_number:z.string().nullable(),customer_name:z.string().nullable(),job_number:z.string().nullable(),vendor_name:z.string().nullable()});
const responseSchema=z.object({company_id:uuid,order_id:uuid.nullable(),production_job_id:uuid.nullable(),finishing_job_id:uuid.nullable(),integrity_ok:z.literal(true),scope_count:count,
  page:z.number().int().positive(),page_size:z.literal(10),total_count:count,
  summary:z.object({active_count:count,retry_eligible_count:count,original_input_kg:kg,accepted_output_kg:kg,pending_input_kg:kg,at_vendor_input_kg:kg,not_required_input_kg:kg,remaining_rejected_kg:kg,recorded_difference_kg:quantity(true)}),
  status_counts:z.object({planned:count,sent_to_vendor:count,in_process:count,received:count,completed:count,rejected:count,not_required:count}),
  queues:z.object({planned:z.array(rowSchema).max(10),sent_to_vendor:z.array(rowSchema).max(10),in_process:z.array(rowSchema).max(10),received:z.array(rowSchema).max(10),rejected:z.array(rowSchema).max(10)}),
  rows:z.array(rowSchema).max(10),vendors:z.array(z.object({id:uuid,company_id:uuid,vendor_name:z.string(),vendor_type:z.enum(['powder_coating','anodizing','other'])}))});

export type FinishingWorkload=z.infer<typeof responseSchema>;
export type FinishingWorkloadRow=z.infer<typeof rowSchema>;
export type FinishingWorkloadOptions={orderId:string|null;productionJobId:string|null;recordId:string|null;status:string;search:string;sort:typeof finishingSorts[number];direction:'asc'|'desc';page:number};

export function getFinishingWorkloadOptions(params:Record<string,string|string[]|undefined>,recordId:string|null=null):FinishingWorkloadOptions{
  const first=(name:string)=>{const value=params[name];return (Array.isArray(value)?value[0]:value)??'';};
  const key=(value:string)=>value?uuid.parse(value):null;
  const page=first('page')||'1';if(!/^\d+$/.test(page)||Number(page)<1||Number(page)>100000000)throw new Error('Invalid finishing page');
  const status=first('status');if(status&&!finishingStatuses.includes(status as typeof finishingStatuses[number]))throw new Error('Invalid finishing status');
  const sort=first('sort')||'planned_date';if(!finishingSorts.includes(sort as typeof finishingSorts[number]))throw new Error('Invalid finishing sort');
  const direction=first('direction')||'asc';if(direction!=='asc'&&direction!=='desc')throw new Error('Invalid finishing sort direction');
  const search=first('q').trim();if(search.length>100)throw new Error('Finishing search must be 100 characters or fewer');
  return {orderId:key(first('order_id')),productionJobId:key(first('production_job_id')),recordId:key(recordId??''),status,search,sort:sort as FinishingWorkloadOptions['sort'],direction,page:Number(page)};
}

export function finishingWorkloadHref(path:string,options:FinishingWorkloadOptions,patch:Partial<FinishingWorkloadOptions>={}){
  const next={...options,...patch},query=new URLSearchParams();
  for(const [key,value] of Object.entries({order_id:next.orderId,production_job_id:next.productionJobId,status:next.status,q:next.search,sort:next.sort,direction:next.direction,page:String(next.page)}))if(value)query.set(key,value);
  return `${path}?${query}`;
}

export async function loadFinishingWorkload(client:Pick<SupabaseClient,'rpc'>,companyId:string,options:FinishingWorkloadOptions):Promise<FinishingWorkload>{
  const result=await client.rpc('get_finishing_workload',{p_order_id:options.orderId,p_production_job_id:options.productionJobId,p_finishing_job_id:options.recordId,
    p_status:options.status,p_search:options.search,p_sort:options.sort,p_direction:options.direction,p_page:options.page});
  const parsed=responseSchema.safeParse(result.data);
  const unavailable=()=>new Error('Finishing quantities and retry links could not be verified. Refresh after the data or database connection is restored.');
  if(result.error||!parsed.success)throw unavailable();
  const data=parsed.data,summary=data.summary,counts=data.status_counts;
  const active=counts.planned+counts.sent_to_vendor+counts.in_process+counts.received;
  const totalPages=Math.max(1,Math.ceil(data.total_count/10));
  if(data.company_id!==companyId.toLowerCase()||data.order_id!==options.orderId||data.production_job_id!==options.productionJobId||data.finishing_job_id!==options.recordId
    ||Object.values(counts).reduce((sum,value)=>sum+value,0)!==data.scope_count||summary.active_count!==active||summary.retry_eligible_count>counts.rejected
    ||data.total_count>data.scope_count||data.page!==Math.min(options.page,totalPages)
    ||data.rows.length!==Math.min(10,Math.max(data.total_count-(data.page-1)*10,0))
    ||summary.at_vendor_input_kg>summary.pending_input_kg+0.001)throw unavailable();
  const milli=(value:number)=>Math.round(value*1000);
  const balance=milli(summary.original_input_kg)-milli(summary.accepted_output_kg)-milli(summary.pending_input_kg)-milli(summary.not_required_input_kg)-milli(summary.remaining_rejected_kg);
  if(!Number.isSafeInteger(balance)||balance!==milli(summary.recorded_difference_kg))throw unavailable();
  if(!options.search&&!options.recordId&&data.total_count!==(options.status?counts[options.status as keyof typeof counts]:data.scope_count))throw unavailable();
  const verifyRows=(rows:FinishingWorkloadRow[])=>{
    const ids=new Set<string>();for(const row of rows){
      const final=['completed','rejected'].includes(row.status),recoverable=Math.min(Number(row.rejection_weight_kg??0),Math.max(row.input_weight_kg-Number(row.output_weight_kg??0),0));
      const remaining=final?Math.max(Number(row.rejection_weight_kg??0)-(row.corrective_retry?.input_weight_kg??0),0):0;
      if(ids.has(row.id)||row.company_id!==data.company_id||(options.orderId&&row.order_id!==options.orderId)||(options.productionJobId&&row.production_job_id!==options.productionJobId)
        ||row.input_weight_kg<=0||(row.can_retry&&(row.status!=='rejected'||row.corrective_retry!==null||Number(row.rejection_weight_kg)<=0))
        ||(row.corrective_retry&&(row.status!=='rejected'||row.corrective_retry.id===row.id||row.corrective_retry.input_weight_kg<=0))
        ||(row.corrective_retry&&Math.abs(row.corrective_retry.input_weight_kg-recoverable)>0.01)
        ||milli(row.remaining_rejected_kg)!==milli(remaining)||row.can_retry!==(row.status==='rejected'&&row.corrective_retry===null&&recoverable>0)
        ||(final&&(row.output_weight_kg===null||row.rejection_weight_kg===null||row.output_weight_kg+row.rejection_weight_kg>row.input_weight_kg+0.01)))throw unavailable();
      ids.add(row.id);
    }
  };
  verifyRows(data.rows);if(data.rows.some(row=>(options.status&&row.status!==options.status)||(options.recordId&&row.id!==options.recordId)))throw unavailable();
  for(const status of finishingAttentionStatuses){const rows=data.queues[status];verifyRows(rows);if(rows.length!==Math.min(10,counts[status])||rows.some(row=>row.status!==status))throw unavailable();}
  if(new Set(data.vendors.map(row=>row.id)).size!==data.vendors.length||data.vendors.some(row=>row.company_id!==data.company_id))throw unavailable();
  return data;
}

export function toFinishingWorkflowJob(row:FinishingWorkloadRow){
  return {...row,orders:{order_number:row.order_number,customers:{company_name:row.customer_name}},production_jobs:{job_number:row.job_number},vendors:{vendor_name:row.vendor_name}};
}
