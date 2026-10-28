"use server";
import {z} from "zod";
import {getSessionContext} from "@/lib/auth";
import {can} from "@/lib/auth/permissions";
import {createClient} from "@/lib/supabase/server";
import {materialSuggestionInputSchema,materialSuggestionsSchema,transactionProgressSchema} from "@/lib/workflow/transaction-evidence";
export async function materialSuggestionsAction(input:unknown){
  try{const context=await getSessionContext(),parsed=materialSuggestionInputSchema.safeParse(input);
    if(!parsed.success||context.dealerId||context.role.startsWith("dealer")||!["owner","admin","sales","sales_manager","production_manager","production","factory_manager","inventory_manager","dispatch_manager","dispatch","quality"].includes(context.role))return {success:false as const,error:"Material suggestions are not permitted for this request."};
    const client=await createClient(),result=await client.rpc("material_suggestion_command",{p_payload:parsed.data});
    if(result.error)return {success:false as const,error:"Material availability could not be verified. Refresh before selecting or allocating material."};
    return {success:true as const,data:materialSuggestionsSchema.parse(result.data)};
  }catch{return {success:false as const,error:"Material suggestions are unavailable. No allocation has been made."};}
}
export async function orderTransactionProgressAction(orderId:unknown){
  try{const context=await getSessionContext(),parsed=z.string().uuid().safeParse(orderId);
    if(!parsed.success||context.dealerId||context.role.startsWith("dealer")||!can(context.role,"read","orders"))return {success:false as const,error:"This order progress is not available to your session."};
    const client=await createClient(),result=await client.rpc("order_transaction_progress",{p_order_id:parsed.data});
    if(result.error)return {success:false as const,error:"Confirmed transaction progress is unavailable. Refresh to verify it."};
    return {success:true as const,data:transactionProgressSchema.parse(result.data)};
  }catch{return {success:false as const,error:"Confirmed transaction progress could not be read."};}
}
