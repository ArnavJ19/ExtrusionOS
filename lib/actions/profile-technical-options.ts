"use server";
import {getSessionContext} from "@/lib/auth";
import {createClient} from "@/lib/supabase/server";
import {technicalCatalogSchema,technicalOptionCommandSchema,technicalOptionsSchema} from "@/lib/workflow/profile-technical-options";
export async function profileTechnicalAction(input:unknown){
  try{const context=await getSessionContext(),parsed=technicalOptionCommandSchema.safeParse(input);
    if(!parsed.success||context.dealerId||context.role.startsWith("dealer"))return {success:false as const,error:"Check the permitted technical option request."};
    const {command,...payload}=parsed.data;
    const roles=command==="option.create"||command==="catalog.list"?["owner","admin","production_manager","quality"]:command==="option.approve"||command==="option.withdraw"?["owner","admin","quality"]:["owner","admin","sales","sales_manager","production_manager","production","factory_manager","quality","inventory_manager","accounts","viewer"];
    if(!roles.includes(context.role))return {success:false as const,error:"This action is not permitted for your role."};
    const client=await createClient(),result=await client.rpc("profile_technical_command",{p_command:command,p_payload:payload});
    if(result.error){const known=["Active profile is unavailable","An approved drawing revision is required","Choose active company alloy and temper masters","That request identity was used for different details","Technical option is unavailable","Another qualified reviewer must approve this technical option","Only draft technical options can be approved","Profile specifications changed. Create a new technical option"];return {success:false as const,error:known.includes(result.error.message)?result.error.message:"Technical options are unavailable. Refresh and retry the same request."};}
    if(command==="options.list")return {success:true as const,kind:"options" as const,data:technicalOptionsSchema.parse(result.data)};
    if(command==="catalog.list")return {success:true as const,kind:"catalog" as const,data:technicalCatalogSchema.parse(result.data)};
    return {success:true as const,kind:"saved" as const,data:result.data as {id:string}};
  }catch{return {success:false as const,error:"Technical options could not be confirmed. Refresh before retrying."};}
}
