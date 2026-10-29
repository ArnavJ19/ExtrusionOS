import { z } from "zod";
export const invoiceCommunicationSchema=z.object({invoice_id:z.string().uuid(),invoice_number:z.string(),invoice_date:z.string(),customer_name:z.string(),
  recipient_phone:z.string().nullable(),supplier_name:z.string().nullable(),grand_total:z.number().finite().nonnegative(),
  document_path:z.string(),status:z.string(),delivery_state:z.literal("prepared_only"),fingerprint:z.string().regex(/^[a-f0-9]{32}$/)}).strict()
  .refine(v=>v.document_path===`/api/pdf/invoice/${v.invoice_id}`&&!["draft","cancelled"].includes(v.status),{message:"The issued document reference is invalid."});
export type InvoiceCommunication=z.infer<typeof invoiceCommunicationSchema>;
export function communicationPhone(value:string|null){
  if(!value||!/^[+\d\s()-]+$/.test(value))return null;
  const digits=value.replace(/\D/g,"");
  if(digits.length===10&&/^[6-9]/.test(digits))return `91${digits}`;
  return value.trim().startsWith("+")&&/^[1-9]\d{10,14}$/.test(digits)?digits:null;
}
export function invoiceMessage(value:InvoiceCommunication){
  const invoice=invoiceCommunicationSchema.parse(value),amount=new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR"}).format(invoice.grand_total);
  return `Hello ${invoice.customer_name},\nInvoice ${invoice.invoice_number}, dated ${invoice.invoice_date}, has been issued for ${amount}.\nPlease refer to the approved invoice document for item and tax details.\n${invoice.supplier_name??"Accounts team"}`;
}
