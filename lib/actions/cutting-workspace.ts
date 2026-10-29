"use server";
import {getSessionContext} from "@/lib/auth";import {createClient} from "@/lib/supabase/server";
import {cuttingCommandSchema,cuttingResultSchema} from "@/lib/workflow/cutting-workspace";
export async function cuttingWorkspaceAction(input:unknown){
  try{const context=await getSessionContext(),parsed=cuttingCommandSchema.safeParse(input);
    if(!parsed.success)return {success:false as const,error:parsed.error.issues[0]?.message??"Check the cutting observations."};
    if(context.dealerId||!["owner","admin","production_manager","production","factory_manager","inventory_manager","quality"].includes(context.role))return {success:false as const,error:"Cutting access is not permitted."};
    const {command,...payload}=parsed.data,client=await createClient(),result=await client.rpc("cutting_workspace_command",{p_command:command,p_payload:payload});
    if(result.error){const known=['Another authorized reviewer must approve this cutting rule','An independently approved cutting rule is required','Cutting source or demand changed. Review again','Actual cuts, allowances, remnant and scrap do not reconcile to one source bar'];return {success:false as const,error:known.includes(result.error.message)?result.error.message:"The cutting request could not be confirmed. Recheck sources or retry the same identity."};}
    return {success:true as const,data:cuttingResultSchema.parse(result.data)};
  }catch{return {success:false as const,error:"Cutting confirmation is unavailable. Retry with the same identity."};}
}
