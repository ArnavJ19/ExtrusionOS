"use server";
import {z} from "zod";
import {getSessionContext} from "@/lib/auth";
import {can} from "@/lib/auth/permissions";
import {createClient} from "@/lib/supabase/server";
import {documentCandidatesSchema,linkedDocumentCommandSchema,linkedDocumentsSchema,safeLinkedDocumentPath} from "@/lib/workflow/linked-documents";
export async function linkedDocumentAction(input:unknown){
  try{const context=await getSessionContext(),parsed=linkedDocumentCommandSchema.safeParse(input);
    if(!parsed.success||context.dealerId||context.role.startsWith("dealer"))return {success:false as const,error:"Document access is not permitted for this request."};
    const {command,...payload}=parsed.data;
    if(!can(context.role,"read",payload.entity_type==="quote"?"quotes":"orders")||(["document.link","document.candidates"].includes(command)&&!["owner","admin"].includes(context.role)))return {success:false as const,error:"Document access is not permitted for this role."};
    const client=await createClient(),result=await client.rpc("linked_document_command",{p_command:command,p_payload:payload});
    if(result.error)return {success:false as const,error:"The document is unavailable for this record, revision or role. Refresh and review its approval and source."};
    if(command==="document.list")return {success:true as const,kind:"list" as const,data:linkedDocumentsSchema.parse(result.data)};
    if(command==="document.candidates")return {success:true as const,kind:"candidates" as const,data:documentCandidatesSchema.parse(result.data)};
    if(command==="document.open"){
      const source=z.object({bucket:z.literal("documents"),path:z.string(),file_name:z.string()}).strict().parse(result.data);
      if(!safeLinkedDocumentPath(context.companyId,source.path))return {success:false as const,error:"The document storage reference is unavailable."};
      const signed=await client.storage.from(source.bucket).createSignedUrl(source.path,60);
      if(signed.error||!signed.data?.signedUrl)return {success:false as const,error:"The approved file could not be opened. Retry after checking storage access."};
      return {success:true as const,kind:"url" as const,data:{url:signed.data.signedUrl,fileName:source.file_name}};
    }
    return {success:true as const,kind:"linked" as const,data:z.object({id:z.string().uuid()}).strict().parse(result.data)};
  }catch{return {success:false as const,error:"Document access or linking could not be confirmed. Retry the same link request to check its result."};}
}
