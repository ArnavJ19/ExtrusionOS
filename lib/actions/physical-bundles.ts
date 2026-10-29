"use server";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getDispatchSourcesAction } from "@/lib/actions/dispatches";
import { readDispatchManifest,readDispatchPreparationSources } from "@/lib/dispatches/preparation";
import { physicalBundleListRequest,physicalBundleListSchema,physicalBundleObservationSchema } from "@/lib/workflow/physical-bundles";
const permitted=(role:string)=>["owner","admin","factory_manager","dispatch_manager","dispatch","inventory_manager"].includes(role);
export async function listPhysicalBundlesAction(input:unknown){
  try {const context=await getSessionContext(),parsed=physicalBundleListRequest.safeParse(input);
    if(!parsed.success||context.dealerId||!permitted(context.role))return {success:false as const,error:"Bundle selection is not permitted."};
    const client=await createClient(),result=await client.rpc("physical_bundle_command",{p_command:"bundles.list",p_payload:parsed.data});
    if(result.error)throw result.error;return {success:true as const,data:physicalBundleListSchema.parse(result.data)};
  }catch{return {success:false as const,error:"Prepared bundles are unavailable. Retry the source check."};}
}
export async function recordPhysicalBundleAction(input:unknown){
  try {const context=await getSessionContext(),parsed=physicalBundleObservationSchema.safeParse(input);
    if(!parsed.success)return {success:false as const,error:parsed.error.issues[0]?.message??"Check physical observations."};
    if(context.dealerId||!permitted(context.role))return {success:false as const,error:"Bundle recording is not permitted."};
    const result=await getDispatchSourcesAction(parsed.data.order_id);
    if(!result.success)return result;
    const sources=readDispatchPreparationSources(result),source=sources.find(row=>row.id===parsed.data.source_line_id);
    if(!source)return {success:false as const,error:"This source is no longer eligible for dispatch."};
    const {id,order_id,...observation}=parsed.data;
    readDispatchManifest(sources,context.companyId,order_id,[Object.fromEntries(Object.entries(observation).map(([key,value])=>[key,String(value)])) as Parameters<typeof readDispatchManifest>[3][number]]);
    const client=await createClient(),saved=await client.rpc("physical_bundle_command",{p_command:"bundle.record",p_payload:{...parsed.data,source_kind:source.sourceKind}});
    if(saved.error)throw saved.error;return {success:true as const,data:z.object({id:z.string().uuid(),replayed:z.boolean()}).strict().parse(saved.data)};
  }catch{return {success:false as const,error:"Bundle recording could not be confirmed. Retry with the same identity; do not create a second tag."};}
}
