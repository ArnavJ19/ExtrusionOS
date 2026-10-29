"use server";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { invoiceCommunicationSchema } from "@/lib/workflow/transaction-communication";
export async function invoiceCommunicationAction(input:unknown){
  try{const context=await getSessionContext(),request=z.object({invoice_id:z.string().uuid()}).strict().safeParse(input);
    if(!request.success||context.dealerId||!["owner","admin","accounts"].includes(context.role))return {success:false as const,error:"Invoice communication is not permitted."};
    const client=await createClient(),result=await client.rpc("invoice_communication_preview",{p_invoice_id:request.data.invoice_id});
    if(result.error)throw result.error;return {success:true as const,data:invoiceCommunicationSchema.parse(result.data)};
  }catch{return {success:false as const,error:"An issued invoice with recorded party details could not be verified. No message was sent."};}
}
