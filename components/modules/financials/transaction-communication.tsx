"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { invoiceCommunicationAction } from "@/lib/actions/transaction-communication";
import { communicationPhone,invoiceMessage,type InvoiceCommunication } from "@/lib/workflow/transaction-communication";
export function TransactionCommunication({invoiceId}:{invoiceId:string}){
  const [preview,setPreview]=useState<InvoiceCommunication|null>(null),[pending,setPending]=useState(false),[message,setMessage]=useState("");
  async function prepare(){if(pending)return;setPending(true);setMessage("");try{const result=await invoiceCommunicationAction({invoice_id:invoiceId});if(result.success){setPreview(result.data);setMessage("Prepared for review. Delivery has not been confirmed.");}else{setPreview(null);setMessage(result.error);}}catch{setPreview(null);setMessage("Preview is unavailable. No message was sent.");}finally{setPending(false);}}
  async function copy(){if(pending||!preview)return;setPending(true);try{const result=await invoiceCommunicationAction({invoice_id:invoiceId});
    if(!result.success){setPreview(null);setMessage(result.error);return;}
    if(result.data.fingerprint!==preview.fingerprint){setPreview(result.data);setMessage("The invoice changed. Review the updated outgoing text before copying.");return;}
    await navigator.clipboard.writeText(invoiceMessage(result.data));setMessage("Message copied. Delivery has not been confirmed.");
  }catch{setMessage("The message could not be copied. Delivery has not been confirmed.");}finally{setPending(false);}}
  return <section aria-label="Invoice document and message" className="min-w-0 space-y-3 rounded-2xl border bg-white p-5"><h2 className="text-lg font-bold">Invoice document and message</h2>
    <Button type="button" variant="secondary" disabled={pending} onClick={prepare}>{pending?"Verifying invoice...":"Prepare customer message"}</Button>
    {preview?<div className="min-w-0 space-y-3"><p>Recipient from issued invoice: {preview.customer_name} / {communicationPhone(preview.recipient_phone)?`+${communicationPhone(preview.recipient_phone)}`:"No verified phone captured"}</p>
      <label className="block">Outgoing text<textarea className="form-input mt-1 min-h-44 w-full" readOnly value={invoiceMessage(preview)}/></label>
      <div className="flex flex-wrap gap-3"><Button type="button" disabled={pending} onClick={copy}>Recheck and copy message</Button><a className="self-center font-semibold underline" href={preview.document_path} target="_blank" rel="noreferrer">Open invoice PDF to print or download</a></div>
    </div>:null}
    {message?<p role="status" className="break-words text-sm">{message}</p>:null}
    <p className="text-xs text-slate-500">This prepares outgoing content from the issued transaction. Sending and delivery require a connected provider; no provider is configured in this workflow.</p>
  </section>;
}
