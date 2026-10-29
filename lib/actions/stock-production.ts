"use server";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { stockProductionCommandSchema,stockProductionResultSchema } from "@/lib/workflow/stock-production";
export async function stockProductionAction(input:unknown){
  try{const context=await getSessionContext(),request=stockProductionCommandSchema.safeParse(input);
    if(!request.success||context.dealerId||!["owner","admin","production_manager","factory_manager","inventory_manager"].includes(context.role))return {success:false as const,error:"Stock planning is not permitted for this request."};
    const {command,...payload}=request.data,client=await createClient(),result=await client.rpc("stock_production_command",{p_command:command,p_payload:payload});
    if(result.error){const known=['Stock or demand changed. Review the allocation again','Allocation exceeds available whole pieces','Stock and production would exceed the line requirement or source balance','Reconcile existing unassigned reservations before planning this line','Repeated profile and finish lines require a resolved dispatch-line mapping before stock allocation'];return {success:false as const,uncertain:command==="stock.allocate"&&!known.includes(result.error.message),error:known.includes(result.error.message)?result.error.message:"The stock requirement could not be verified. Recheck the line before retrying the same request."};}
    return {success:true as const,data:stockProductionResultSchema.parse(result.data)};
  }catch{return {success:false as const,uncertain:true as const,error:"Stock allocation is unconfirmed. Refresh requirements or retry with the same identity."};}
}
