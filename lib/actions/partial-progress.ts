"use server";
import {z} from "zod";
import {getSessionContext} from "@/lib/auth";
import {createClient} from "@/lib/supabase/server";
import {partialProgressSchema} from "@/lib/workflow/partial-progress";
export async function partialProgressAction(input:unknown){
  try{const c=await getSessionContext(),p=z.object({order_id:z.string().uuid(),page:z.number().int().min(1).max(10000)}).strict().parse(input);if(c.dealerId)return {success:false as const,error:"Internal order progress is unavailable."};const r=await(await createClient()).rpc("order_partial_progress",{p_order_id:p.order_id,p_page:p.page});if(r.error)throw r.error;return {success:true as const,data:partialProgressSchema.parse(r.data)};}catch{return {success:false as const,error:"The complete line balances could not be verified. Refresh before acting."};}
}
