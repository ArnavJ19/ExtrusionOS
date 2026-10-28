import {z} from "zod";
const uuid=z.string().uuid(),target={entity_type:z.enum(["quote","order"]),entity_id:uuid};
export const linkedDocumentCommandSchema=z.discriminatedUnion("command",[
  z.object({command:z.literal("document.list"),...target,page:z.number().int().min(1).max(10000).default(1)}).strict(),
  z.object({command:z.literal("document.candidates"),...target,page:z.number().int().min(1).max(10000).default(1),search:z.string().trim().max(80).default("")}).strict(),
  z.object({command:z.literal("document.link"),...target,id:uuid,document_id:uuid,purpose:z.string().trim().min(3).max(300)}).strict(),
  z.object({command:z.literal("document.open"),...target,document_id:uuid}).strict()
]);
export const linkedDocumentsSchema=z.object({page:z.number().int(),items:z.array(z.object({id:uuid,document_id:uuid,purpose:z.string(),document_version:z.number().int(),file_name:z.string(),document_type:z.string(),accessible:z.boolean()}).strict())}).strict();
export const documentCandidatesSchema=z.object({page:z.number().int(),items:z.array(z.object({id:uuid,file_name:z.string(),document_type:z.string(),version_number:z.number().int().nullable()}).strict())}).strict();
export function safeLinkedDocumentPath(companyId:string,path:string){return path.startsWith(`${companyId}/`)&&!/(^|\/)\.\.(\/|$)|:\/\/|\\|[\u0000-\u001f]|%(?:25|2e|2f|5c)/i.test(path);}
