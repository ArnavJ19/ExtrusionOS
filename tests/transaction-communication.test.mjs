import test from 'node:test';import assert from 'node:assert/strict';
import {invoiceCommunicationSchema,invoiceMessage,communicationPhone} from '../lib/workflow/transaction-communication.ts';
const id='bc000000-0000-4000-8000-000000000001';
const data={invoice_id:id,invoice_number:'INV-1',invoice_date:'2026-10-29',customer_name:'Customer',recipient_phone:'9876543210',supplier_name:'Factory',grand_total:11800,document_path:`/api/pdf/invoice/${id}`,status:'sent',delivery_state:'prepared_only',fingerprint:'a'.repeat(32)};
test('18: message uses issued customer fields and cannot include internal cost or fake delivery',()=>{
  assert.match(invoiceMessage(data),/INV-1/);assert.match(invoiceMessage(data),/11,800/);
  for(const patch of [{cost:123},{margin:20},{internal_notes:'private'},{delivery_state:'delivered'},{status:'draft'},{document_path:'https://outside.invalid'}])assert.equal(invoiceCommunicationSchema.safeParse({...data,...patch}).success,false);
});
test('18: phone formatting refuses ambiguous recipients and treats formatting as preparation only',()=>{
  assert.equal(communicationPhone('98765 43210'),'919876543210');assert.equal(communicationPhone('+91 (98765) 43210'),'919876543210');
  for(const input of [null,'123','send to 9876543210','9876543210;9999999999'])assert.equal(communicationPhone(input),null);
});
