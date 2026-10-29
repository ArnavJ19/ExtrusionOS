"use server";
import {getSessionContext} from "@/lib/auth";import {createClient} from "@/lib/supabase/server";
import {machineUsageCommandSchema,machineUsageResultSchema} from "@/lib/workflow/machine-usage";
export async function machineUsageAction(input:unknown){
  try{const context=await getSessionContext(),parsed=machineUsageCommandSchema.safeParse(input);
    if(!parsed.success)return {success:false as const,error:parsed.error.issues[0]?.message??"Check the machine observations."};
    if(context.dealerId||!["owner","admin","production_manager","production","factory_manager","accounts"].includes(context.role))return {success:false as const,error:"Machine usage is not permitted."};
    const {command,...payload}=parsed.data,client=await createClient(),result=await client.rpc("machine_usage_command",{p_command:command,p_payload:payload});
    if(result.error){const known=['Another authorized reviewer must approve this tariff','An approved applicable tariff is required','Only the identified operator records this run','Independent meter resolution is required','Only a running interval can pause','Only a paused interval can resume','Only an active interval can stop','Closing reading is invalid','Opening reading is invalid'];return {success:false as const,error:known.includes(result.error.message)?result.error.message:"Machine usage could not be confirmed. Reload the meter state or retry the same event identity."};}
    return {success:true as const,data:machineUsageResultSchema.parse(result.data)};
  }catch{return {success:false as const,error:"Machine usage confirmation is unavailable. Retry the same event identity."};}
}
