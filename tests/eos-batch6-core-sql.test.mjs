import test from 'node:test';import assert from 'node:assert/strict';
import {createBatch6CoreFixture,cid} from '../scripts/lib/eos-batch6-core-fixture.mjs';
import {partialProgressSchema} from '../lib/workflow/partial-progress.ts';import {safePortalOrder,portalOrderDocument} from '../lib/workflow/customer-self-service.ts';
let f;const returned=cid(4210),task=cid(4220),boundaryTask=cid(4221),portal=cid(4230),otherPortal=cid(4231),response=cid(4232);
test.before(async()=>{f=await createBatch6CoreFixture();});test.after(async()=>f?.close());
const returns=(command,payload)=>f.command('connected_return_command',command,payload);
const assurance=(command,payload)=>f.command('operational_assurance_command',command,payload);
const self=(command,payload)=>f.command('portal_self_service_command',command,payload);
test('29: exact order line packing and issued billing are independently reconciled for a real partial dispatch',async()=>{
  const p=partialProgressSchema.parse((await f.db.query('select order_partial_progress($1,1) data',[f.ids.order])).rows[0].data),line=p.items[0];
  assert.equal(p.unlinked_packing_rows,0);assert.equal(line.ordered_kg,960);assert.equal(line.packed_actual_kg,288);assert.equal(line.dispatched_actual_kg,288);assert.equal(line.billed_kg,288);assert.equal(line.remaining_to_pack_order_kg,672);assert.equal(line.produced_kg,0);assert.equal(line.unbilled_packed_kg,0);
  const queue=(await f.db.query('select packed_kg,dispatched_kg from private.order_line_requirements($1,$2)',[f.ids.company,f.ids.order])).rows[0];assert.equal(Number(queue.packed_kg),288);assert.equal(Number(queue.dispatched_kg),288);
  await f.actor(f.ids.production);const safe=(await f.db.query('select order_partial_progress($1,1) data',[f.ids.order])).rows[0].data;assert.equal('billed_kg' in safe.items[0],false);assert.equal(safe.items[0].unbilled_packed_kg,null);await f.actor();
});
test('56: actual partial return receipts replay exactly and independent inspection precedes measured held stock',async()=>{
  const payload={id:returned,packing_list_item_id:f.packing.id,received_kg:48,received_pieces:10,received_metres:60,reason:'Ten intact pieces physically returned'};
  await returns('return.receive',payload);assert.equal((await returns('return.receive',payload)).replayed,true);
  await f.db.query('select transition_dispatch_delivery_atomic($1,$2,$3,$4)',[f.dispatch,'returned',null,'Partial physical receipt is under independent inspection']);
  await assert.rejects(f.db.query('select issue_dispatch_return_credit_note_atomic($1,$2,$3)',[f.dispatch,'Legacy full credit must not bypass inspection',cid(4290)]),/proportional credit/);
  await assert.rejects(f.db.query("select record_material_disposition('dispatch_return',$1,$2,'return_to_stock',48,60,'Legacy writer must respect the pending receipt')",[f.dispatch,f.packing.id]),/connected return receipt/);
  await assert.rejects(returns('return.receive',{...payload,received_kg:49}),/different observations/);
  await assert.rejects(returns('return.receive',{...payload,id:cid(4211),received_kg:250,received_pieces:55,received_metres:330}),/Cumulative returns/);
  await assert.rejects(returns('return.dispose',{id:returned}),/Inspect the return/);
  await assert.rejects(returns('return.inspect',{id:returned,disposition:'return_to_stock',note:'Observed intact matching lengths'}),/Another quality reviewer/);
  await f.actor(f.ids.admin);await returns('return.inspect',{id:returned,disposition:'return_to_stock',note:'Observed intact matching lengths'});await returns('return.dispose',{id:returned});await returns('return.dispose',{id:returned});await f.actor();
  const stocks=(await f.db.query('select s.* from profile_stock_batches s join material_dispositions m on m.profile_stock_batch_id=s.id join connected_return_receipts r on r.disposition_id=m.id where r.id=$1',[returned])).rows;assert.equal(stocks.length,1);assert.equal(stocks[0].qc_status,'on_hold');assert.equal(Number(stocks[0].total_weight_kg),48);assert.equal(Number(stocks[0].length_m),60);assert.equal(Number(stocks[0].quantity_pieces),10);
});
test('56: a partial return cannot obtain whole-row credit; proportional credit preserves cash and original invoice history',async()=>{
  await assert.rejects(f.db.query('select issue_partial_return_credit_note_atomic($1,$2,$3,$4)',[f.dispatch,[f.packing.id],'Do not credit unreturned material',cid(4212)]),/proportional credit|physically dispositioned/);
  await returns('return.credit',{id:returned});await returns('return.credit',{id:returned});
  const notes=(await f.db.query('select n.grand_total,l.quantity_kg from credit_notes n join credit_note_packing_lines l on l.credit_note_id=n.id where l.packing_list_item_id=$1',[f.packing.id])).rows;assert.equal(notes.length,1);assert.equal(Number(notes[0].quantity_kg),48);assert.equal(Number(notes[0].grand_total),14160);
  const inv=(await f.db.query('select grand_total,amount_paid,credited_amount from invoices where id=$1',[f.invoice])).rows[0];assert.equal(Number(inv.grand_total),84960);assert.equal(Number(inv.amount_paid),0);assert.equal(Number(inv.credited_amount),14160);
});
test('73: important source changes route completed work for independent review and retain completion history',async()=>{
  await f.db.query("insert into tasks(id,company_id,title,status,related_entity_type,related_entity_id,created_by) values($1,$2,'Check approved drawing','open','order',$3,$4)",[task,f.ids.company,f.ids.order,f.ids.owner]);await f.db.query("update tasks set status='completed',completed_at=clock_timestamp() where id=$1",[task]);
  const prior=(await f.db.query('select completed_at,(select count(*) from task_completion_checks where task_id=$1) checks from tasks where id=$1',[task])).rows[0];
  await f.db.query("update aluminium_profiles set drawing_revision='B' where id=$1",[f.ids.profile]);
  const r=(await assurance('reviews.list',{})).items.find(r=>r.task_id===task);assert.ok(r);assert.equal(r.previous_task_status,'completed');assert.equal(r.before_snapshot.drawing_revision,'A');assert.equal(r.after_snapshot.drawing_revision,'B');assert.equal((await f.db.query('select status from tasks where id=$1',[task])).rows[0].status,'completed');
  await assert.rejects(assurance('review.resolve',{id:r.id,fingerprint:r.source_fingerprint,decision:'accepted',note:'The original changer cannot approve'}),/Another authorized reviewer/);
  await f.actor(f.ids.admin);await assurance('review.resolve',{id:r.id,fingerprint:r.source_fingerprint,decision:'repeat_required',note:'A new drawing check is required for revision B'});await f.actor();
  const after=(await f.db.query('select followup_task_id from source_change_reviews where id=$1',[r.id])).rows[0];assert.ok(after.followup_task_id);await assert.rejects(f.db.query("update tasks set status='in_progress' where id=$1",[task]),/repeated check/);
  await f.db.query("update tasks set status='completed' where id=$1",[after.followup_task_id]);const preserved=(await f.db.query('select completed_at,(select count(*) from task_completion_checks where task_id=$1) checks from tasks where id=$1',[task])).rows[0];assert.deepEqual(preserved,prior);assert.equal(new Date((await f.db.query('select previous_completed_at from source_change_reviews where id=$1',[r.id])).rows[0].previous_completed_at).getTime(),new Date(prior.completed_at).getTime());
});
test('75: configured boundary tasks require current source-derived reconciliation and respect a newer hold',async()=>{
  await assurance('boundary.enable',{source_type:'dispatch'});
  await f.db.query("insert into tasks(id,company_id,title,status,related_entity_type,related_entity_id,created_by) values($1,$2,'Close dispatch reconciliation','open','dispatch',$3,$4)",[boundaryTask,f.ids.company,f.dispatch,f.ids.owner]);
  await assert.rejects(f.db.query("update tasks set status='completed' where id=$1",[boundaryTask]),/Reconcile the current/);
  await assert.rejects(f.db.query("insert into tasks(company_id,title,status,related_entity_type,related_entity_id,created_by) values($1,'Attempt direct closed boundary','completed','dispatch',$2,$3)",[f.ids.company,f.dispatch,f.ids.owner]),/Reconcile the current/);
  await assert.rejects(f.db.query("update tasks set related_entity_type='dispatch',related_entity_id=$1 where id=$2",[f.dispatch,task]),/Completed task lineage/);
  const s=(await assurance('boundary.evaluate',{source_type:'dispatch',source_id:f.dispatch})).snapshot;assert.equal(s.expected,288);assert.equal(s.recorded,288);assert.equal(s.unexplained,0);
  const payload={id:cid(4240),source_type:'dispatch',source_id:f.dispatch,fingerprint:s.fingerprint,decision:'reconciled',note:'Actual packing and dispatch weights reconciled'};await assurance('boundary.record',payload);await assurance('boundary.record',payload);
  await assurance('boundary.record',{...payload,id:cid(4241),decision:'hold',note:'Rechecking the physical bundle evidence'});
  await assert.rejects(f.db.query("update tasks set status='completed' where id=$1",[boundaryTask]),/Reconcile the current/);
  await assurance('boundary.record',{...payload,id:cid(4242)});await f.db.query("update tasks set status='completed' where id=$1",[boundaryTask]);
  await assert.rejects(assurance('boundary.record',{...payload,id:cid(4243),fingerprint:'0'.repeat(32)}),/changed/);
});

test('73: source dependency comparisons include actual inspection readings independently of unchanged approval status',async()=>{
  const source={id:cid(4292),status:'approved',quantity_checked_kg:10,hardness_webster:12,surface_finish_ok:true,weight_per_meter_actual:0.8,dimensional_variance:'0.1 mm'};
  const project=async x=>(await f.db.query("select private.assurance_basis('quality_inspections',$1) data",[x])).rows[0].data;
  const before=await project(source),after=await project({...source,hardness_webster:8});
  assert.notDeepEqual(before,after);assert.equal(before.status,after.status);assert.equal(after.hardness_webster,8);
  assert.deepEqual(await project({...source,notes:'Only a spelling correction'}),before);
});
test('73: reviewing the latest of several source changes supersedes older pending reviews without losing their evidence',async()=>{
  const id=cid(4225);await f.db.query("insert into tasks(id,company_id,title,status,related_entity_type,related_entity_id,created_by) values($1,$2,'Repeated source review','open','order',$3,$4)",[id,f.ids.company,f.ids.order,f.ids.owner]);
  await f.db.query("update aluminium_profiles set drawing_revision='C' where id=$1",[f.ids.profile]);await f.db.query("update aluminium_profiles set drawing_revision='D' where id=$1",[f.ids.profile]);
  const pending=(await f.db.query("select * from source_change_reviews where task_id=$1 and status='requires_review' order by changed_at,id",[id])).rows;assert.equal(pending.length,2);
  await f.actor(f.ids.admin);await assert.rejects(assurance('review.resolve',{id:pending[0].id,fingerprint:pending[0].source_fingerprint,decision:'accepted',note:'This review refers to an older revision'}),/changed again/);
  await assurance('review.resolve',{id:pending[1].id,fingerprint:pending[1].source_fingerprint,decision:'accepted',note:'Current revision D independently reviewed'});await f.actor();
  const history=(await f.db.query('select status,before_snapshot,after_snapshot from source_change_reviews where task_id=$1 order by changed_at,id',[id])).rows;assert.deepEqual(history.map(r=>r.status),['superseded','accepted']);assert.equal(history[0].after_snapshot.drawing_revision,'C');await f.db.query("update tasks set status='in_progress' where id=$1",[id]);
});
test('52: active external identities see only their own safe projection, document and exact-version responses',async()=>{
  for(const [id,customer] of [[portal,f.ids.customer],[otherPortal,cid(4233)]]){await f.db.query('insert into auth.users(id,email) values($1,$2)',[id,`${id}@portal.invalid`]);if(customer!==f.ids.customer)await f.db.query("insert into customers(id,company_id,customer_name,customer_type) values($1,$2,'Other customer','fabricator')",[customer,f.ids.company]);await f.db.query("insert into portal_users(id,company_id,customer_id,email,full_name,role) values($1,$2,$3,$4,'External sample user','customer_owner')",[id,f.ids.company,customer,`${id}@portal.invalid`]);}
  await f.actor(portal);await f.db.exec('set role authenticated');
  try{const result=await self('order.load',{order_id:f.ids.order});safePortalOrder.parse(result.order);assert.equal(result.order.delivery_address,'Factory gate');assert.equal(result.order.delivery_basis,'current_customer_master');const text=portalOrderDocument(result.order,result.version);assert.match(text,/Commercial section/);for(const key of ['internal_cost','supplier_rate','margin','payment_terms','internal_note'])assert.equal(JSON.stringify(result).includes(`"${key}"`),false);
    const payload={id:response,order_id:f.ids.order,response_type:'delivery_details',version:result.version,text:'Delivery details reviewed for the main gate'};await assert.rejects(self('response.submit',{...payload,version:'0'.repeat(32)}),/summary changed/);await self('response.submit',payload);assert.equal((await self('response.submit',payload)).id,response);
    await assert.rejects(self('response.submit',{...payload,text:'Changed response under the same identity'}),/different details/);
  }finally{await f.db.exec('reset role');}
  await f.actor(otherPortal);assert.equal((await self('orders.list',{})).items.length,0);await assert.rejects(self('order.load',{order_id:f.ids.order}),/unavailable/);await assert.rejects(self('responses.list',{order_id:f.ids.order}),/unavailable/);await f.actor();
  const review=await f.command('portal_response_review_command','responses.list',{});assert.equal(review.items[0].id,response);await f.command('portal_response_review_command','response.review',{id:response,note:'Customer contact and proposed delivery details checked'});
  await f.db.query('update portal_users set is_active=false where id=$1',[portal]);await f.actor(portal);await assert.rejects(self('orders.list',{}),/active customer portal/);await f.actor();
});
test('29/52/56/73/75: new protected boundaries reject anonymous, foreign and nonfinite direct requests',async()=>{
  for(const rpc of ['connected_return_command','operational_assurance_command','portal_self_service_command','master_cleanup_command'])assert.equal((await f.db.query('select has_function_privilege($1,$2,$3) ok',['anon',`${rpc}(text,jsonb)`,'EXECUTE'])).rows[0].ok,false);
  for(const table of ['connected_return_receipts','source_change_reviews','boundary_reconciliations','portal_order_responses']){assert.equal((await f.db.query("select relrowsecurity rls from pg_class where oid=$1::regclass",[table])).rows[0].rls,true);assert.equal((await f.db.query("select has_table_privilege('authenticated',$1,'INSERT') ok",[table])).rows[0].ok,false);}
  await assert.rejects(returns('return.receive',{id:cid(4260),packing_list_item_id:f.packing.id,received_kg:'NaN',received_pieces:1,received_metres:6,reason:'Nonfinite source refused'}),/actual positive/);
  await f.actor(f.ids.dealer);await assert.rejects(assurance('reviews.list',{}),/not permitted/);await assert.rejects(returns('returns.list',{}),/not permitted/);await f.actor();
  const foreign=cid(4270);await f.db.query('insert into auth.users(id,email) values($1,$2)',[foreign,'foreign-owner@batch6.invalid']);await f.db.query("insert into app_users(id,company_id,full_name,email,role,is_active) values($1,$2,'Foreign owner','foreign-owner@batch6.invalid','owner',true)",[foreign,f.ids.foreign]);await f.actor(foreign);
  await assert.rejects(f.db.query('select order_partial_progress($1,1)',[f.ids.order]),/unavailable/);await assert.rejects(assurance('boundary.evaluate',{source_type:'dispatch',source_id:f.dispatch}),/unavailable/);assert.equal((await returns('returns.list',{})).items.length,0);await f.actor();
});

test('73/75: payment reversal flags dependent work while finance values and invoice boundaries stay restricted',async()=>{
  await f.actor();
  const payment=(await f.db.query('select record_payment_atomic($1,$2) data',[f.invoice,{payment_date:'2026-10-29',amount:10,payment_method:'cash',notes:'Local reversal source check',idempotency_key:cid(4280)}])).rows[0].data.payment_id;
  await f.db.query('select reverse_payment_atomic($1,$2,$3)',[payment,'Confirmed sample reversal of required evidence',cid(4281)]);
  assert.ok((await assurance('reviews.list',{})).items.some(x=>x.source_type==='payments'));
  await f.db.query("insert into auth.users(id,email) values($1,'factory-manager@batch6.invalid')",[cid(4282)]);
  await f.db.query("insert into app_users(id,company_id,full_name,email,role,is_active) values($1,$2,'Factory manager','factory-manager@batch6.invalid','factory_manager',true)",[cid(4282),f.ids.company]);
  await f.actor(cid(4282));assert.ok((await assurance('reviews.list',{})).items.every(x=>x.source_type!=='payments'));
  await assert.rejects(assurance('boundary.evaluate',{source_type:'invoice',source_id:f.invoice}),/restricted to accounts/);
  await f.actor();
});
