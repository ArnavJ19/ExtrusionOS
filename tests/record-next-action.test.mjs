import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);require('tsx/cjs');
const {nextRecordAction}=require('../lib/workflow/record-next-action.ts');
const id='bc000000-0000-4000-8000-000000000040';
const record=(kind,status,extra={})=>({kind,status,id,...extra});
test('5: accepted quote action carries its exact identity and completed conversion opens existing order',()=>{
  assert.equal(nextRecordAction('owner',record('quote','customer_approved')).href,`/quotes/${id}/review`);
  assert.equal(nextRecordAction('sales',record('quote','converted_to_order',{linkedOrderId:id})).href,`/orders/${id}`);
});
test('5: costing, customer acceptance and terminal orders have explicit prerequisite explanations',()=>{
  assert.match(nextRecordAction('owner',record('quote','draft',{completeCosting:false})).href,/edit$/);
  assert.match(nextRecordAction('viewer',record('quote','sent')).reason,/acceptance/);
  for(const status of ['cancelled','closed','delivered'])assert.equal(nextRecordAction('dispatch',record('order',status)).href,undefined);
});
test('5: dealers, malformed IDs and roles without source permissions receive no action',()=>{
  for(const role of ['dealer_admin','dealer_staff'])assert.equal(nextRecordAction(role,record('quote','customer_approved')),null);
  assert.equal(nextRecordAction('owner',{...record('order','packing'),id:'../other'}),null);
  assert.equal(nextRecordAction('owner',record('order','packing'),id),null);
  assert.equal(nextRecordAction('production',record('invoice','draft')),null);
});
test('5: actions remain on the selected production job, shipment or invoice',()=>{
  assert.match(nextRecordAction('production',record('production','on_hold')).href,new RegExp(`${id}#production-readiness$`));
  assert.match(nextRecordAction('dispatch',record('dispatch','pending')).href,new RegExp(`${id}/edit$`));
  assert.match(nextRecordAction('accounts',record('invoice','draft')).href,new RegExp(`${id}/edit$`));
  assert.equal(nextRecordAction('viewer',record('order','packing')).href,`/orders/${id}#order-progress`);
});
