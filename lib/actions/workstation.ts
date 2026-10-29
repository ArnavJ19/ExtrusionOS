"use server";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { workstationCommandSchema,workstationResultSchema } from "@/lib/workflow/workstation";
export async function workstationAction(input:unknown){
  try{const context=await getSessionContext(),parsed=workstationCommandSchema.safeParse(input);
    if(!parsed.success||context.dealerId||!["owner","admin","production_manager","production","factory_manager"].includes(context.role))return {success:false as const,error:"Workstation access is not permitted."};
    const {command,...payload}=parsed.data,client=await createClient(),result=await client.rpc("workstation_command",{p_command:command,p_payload:payload});
    if(result.error)throw result.error;return {success:true as const,data:workstationResultSchema.parse(result.data)};
  }catch{return {success:false as const,error:"The station session expired or could not be verified. Identify the operator again."};}
}
export async function switchWorkstationOperatorAction(){
  try{await getSessionContext();const client=await createClient();const result=await client.auth.signOut({scope:"local"});
    return result.error?{success:false as const,error:"Sign-out could not be confirmed. Keep this station locked."}:{success:true as const};
  }catch{return {success:false as const,error:"Sign-out could not be confirmed. Keep this station locked."};}
}
