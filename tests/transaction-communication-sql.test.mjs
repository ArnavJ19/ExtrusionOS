import test from 'node:test';import assert from 'node:assert/strict';
import {createFactoryUpgradeFixture,cid} from '../scripts/lib/factory-upgrade-fixture.mjs';
import {invoiceCommunicationSchema} from '../lib/workflow/transaction-communication.ts';
let f,invoice;test.before(async()=>{f=await createFactoryUpgradeFixture();invoice=cid(890);
  await f.db.query("update companies set name='Invoice factory',gst_number='27ABCDE1234F1Z5' where id=$1",[f.ids.company]);
  await f.db.query("insert into invoices(id,company_id,customer_id,order_id,invoice_number,invoice_date,status,place_of_supply_state_code) values($1,$2,$3,$4,'MESSAGE-1','2026-10-29','draft','27')",[invoice,f.ids.company,f.ids.customer,f.ids.order]);
});test.after(async()=>f?.close());
const load=async()=>invoiceCommunicationSchema.parse((await f.db.query('select invoice_communication_preview($1) data',[invoice])).rows[0].data);
test('18: drafts and unauthorized actors cannot prepare customer documents',async()=>{
  await assert.rejects(load(),/issued invoice/);await f.actor(f.ids.production);await assert.rejects(load(),/not permitted/);await f.actor();
  assert.equal((await f.db.query("select has_function_privilege('anon','invoice_communication_preview(uuid)','EXECUTE') ok")).rows[0].ok,false);
});
test('18: issued preview uses historical snapshots, a bound PDF and no private commercial fields',async()=>{
  await f.db.query("update invoices set status='sent' where id=$1",[invoice]);const first=await load();
  await f.db.query("update customers set customer_name='Changed customer' where id=$1",[f.ids.customer]);const second=await load();
  assert.equal(first.customer_name,second.customer_name);assert.equal(first.fingerprint,second.fingerprint);assert.equal(first.delivery_state,'prepared_only');
  for(const key of ['cost','profit','margin','internal_notes'])assert.equal(key in first,false);
});
