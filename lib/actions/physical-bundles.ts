"use server";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getDispatchSourcesAction } from "@/lib/actions/dispatches";
import { readDispatchManifest,readDispatchPreparationSources } from "@/lib/dispatches/preparation";
import { physicalBundleListRequest,physicalBundleListSchema,physicalBundleObservationSchema } from "@/lib/workflow/physical-bundles";
import { scaleCaptureSchema } from "@/lib/autopilot-batch9/commands";
const permitted=(role:string)=>["owner","admin","factory_manager","dispatch_manager","dispatch","inventory_manager"].includes(role);
export async function listPhysicalBundlesAction(input:unknown){
  try {const context=await getSessionContext(),parsed=physicalBundleListRequest.safeParse(input);
    if(!parsed.success||context.dealerId||!permitted(context.role))return {success:false as const,error:"Bundle selection is not permitted."};
    const client=await createClient(),result=await client.rpc("physical_bundle_command",{p_command:"bundles.list",p_payload:parsed.data});
    if(result.error)throw result.error;return {success:true as const,data:physicalBundleListSchema.parse(result.data)};
  }catch{return {success:false as const,error:"Prepared bundles are unavailable. Retry the source check."};}
}
export type BundleWeightOutcome={source:"scale"|"manual";flagged:boolean;deviation_percent:number|null;theoretical_kg:number|null;tolerance_percent:number|null}|null;
export async function recordPhysicalBundleAction(input:unknown){
  try {// AP-010: how the gross weight was captured travels with the bundle (also through the offline queue) and is
    // recorded once the bundle exists; a missing capture is recorded as typed.
    const {weight_capture:capture,...observed}=(input&&typeof input==="object"?input:{}) as Record<string,unknown>;
    const weight=capture===undefined?{success:true as const,data:{source:"manual" as const}}:scaleCaptureSchema.safeParse(capture);
    if(!weight.success)return {success:false as const,error:weight.error.issues[0]?.message??"Capture the weight again."};
    const context=await getSessionContext(),parsed=physicalBundleObservationSchema.safeParse(observed);
    if(!parsed.success)return {success:false as const,error:parsed.error.issues[0]?.message??"Check physical observations."};
    if(context.dealerId||!permitted(context.role))return {success:false as const,error:"Bundle recording is not permitted."};
    const result=await getDispatchSourcesAction(parsed.data.order_id);
    if(!result.success)return result;
    const sources=readDispatchPreparationSources(result),source=sources.find(row=>row.id===parsed.data.source_line_id);
    if(!source)return {success:false as const,error:"This source is no longer eligible for dispatch."};
    const {id:requestId,order_id,...observation}=parsed.data;
    readDispatchManifest(sources,context.companyId,order_id,[Object.fromEntries(Object.entries(observation).map(([key,value])=>[key,String(value)])) as Parameters<typeof readDispatchManifest>[3][number]]);
    const client=await createClient(),saved=await client.rpc("physical_bundle_command",{p_command:"bundle.record",p_payload:{...parsed.data,id:requestId,source_kind:source.sourceKind}});
    if(saved.error)throw saved.error;const data=z.object({id:z.string().uuid(),replayed:z.boolean()}).strict().parse(saved.data);
    let checked:BundleWeightOutcome=null;
    const recorded=await client.rpc("ap_scale",{p_command:"record",p_payload:{bundle_id:data.id,...weight.data}});
    if(!recorded.error&&recorded.data)checked=z.object({source:z.enum(["scale","manual"]),flagged:z.boolean(),deviation_percent:z.number().nullable(),theoretical_kg:z.number().nullable(),tolerance_percent:z.number().nullable()}).passthrough().parse(recorded.data);
    return {success:true as const,data:{...data,weight:checked}};
  }catch{return {success:false as const,error:"Bundle recording could not be confirmed. Retry with the same identity; do not create a second tag."};}
}
