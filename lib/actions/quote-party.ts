"use server";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { partySitesSchema,partyViewSchema,quotePartyCommandSchema } from "@/lib/workflow/quote-party";
export async function quotePartyAction(input:unknown){
  try{
    const context=await getSessionContext(),parsed=quotePartyCommandSchema.safeParse(input);
    if(!parsed.success)return {success:false as const,error:"Check the party details request."};
    if(context.dealerId||!["owner","admin","sales","sales_manager","accounts"].includes(context.role)||(parsed.data.command==="party.save"&&!["owner","admin"].includes(context.role)))return {success:false as const,error:"This action is not permitted for your role."};
    const {command,...payload}=parsed.data,supabase=await createClient();
    const result=await supabase.rpc("quote_party_command",{p_command:command,p_payload:payload});
    if(result.error){const known=["Quotation is unavailable","Choose an active customer","Choose an active site for this customer","Invalid party overrides","Party or quotation sources changed. Refresh the preview","Issued party details are immutable. Create a quotation revision"];return {success:false as const,error:known.includes(result.error.message)?result.error.message:"Party details are unavailable. Refresh and review before issue."};}
    return command==="sites.list"?{success:true as const,kind:"sites" as const,data:partySitesSchema.parse(result.data)}:{success:true as const,kind:"party" as const,data:partyViewSchema.parse(result.data)};
  }catch{return {success:false as const,error:"Party details could not be loaded or confirmed. Refresh before retrying."};}
}
