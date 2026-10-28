"use server";
import {z} from "zod";
import {getSessionContext} from "@/lib/auth";
import {createClient} from "@/lib/supabase/server";
import {comparisonVendorsSchema,supplierComparisonCommandSchema,supplierComparisonViewSchema,supplierDirectorySchema} from "@/lib/workflow/supplier-comparisons";
export async function supplierComparisonAction(input:unknown){
  try{const context=await getSessionContext(),parsed=supplierComparisonCommandSchema.safeParse(input);
    if(!parsed.success)return {success:false as const,error:parsed.error.issues[0]?.message??"Check the supplier comparison request."};
    if(context.dealerId||!["owner","admin","accounts"].includes(context.role))return {success:false as const,error:"Supplier comparison is not permitted for this role."};
    const {command,...payload}=parsed.data,client=await createClient(),result=await client.rpc("supplier_comparison_command",{p_command:command,p_payload:payload});
    if(result.error){const known=["That request identity was used for different details","Enter a specification, positive quantity and base unit","Piece requirements must be whole numbers","Purchase comparison is unavailable","Offer quantities, rates and tax must be valid numbers","Freight must be a non-negative amount or unknown","Capture supplier reference, payment terms and exclusions","Choose an active company vendor","Supplier source document is unavailable","Supplier offer is unavailable","Resolve unmatched offer conditions before recommending a supplier","Explain the recommendation in 5 to 1000 characters"];return {success:false as const,error:known.includes(result.error.message)?result.error.message:"Supplier comparison could not be confirmed. Refresh or retry the same request."};}
    if(command==="requests.list")return {success:true as const,kind:"directory" as const,data:supplierDirectorySchema.parse(result.data)};
    if(command==="vendors.list")return {success:true as const,kind:"vendors" as const,data:comparisonVendorsSchema.parse(result.data)};
    if(command==="request.load")return {success:true as const,kind:"comparison" as const,data:supplierComparisonViewSchema.parse(result.data)};
    return {success:true as const,kind:"saved" as const,data:z.object({id:z.string().uuid()}).strict().parse(result.data)};
  }catch{return {success:false as const,error:"Supplier comparison is unavailable or the result is uncertain. Retry the same request identity."};}
}
