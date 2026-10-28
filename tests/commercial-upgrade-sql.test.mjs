import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommercialFixture,cid } from '../scripts/lib/commercial-upgrade-fixture.mjs';
import { commercialReviewSchema, commercialReviewCommandSchema,commercialReviewProblems } from '../lib/workflow/commercial-review.ts';
import {partyViewSchema,quotePartyCommandSchema} from '../lib/workflow/quote-party.ts';
import {technicalOptionsSchema,soleTechnicalOption} from '../lib/workflow/profile-technical-options.ts';
import {materialSuggestionsSchema,transactionProgressSchema} from '../lib/workflow/transaction-evidence.ts';
import {linkedDocumentsSchema} from '../lib/workflow/linked-documents.ts';
import {supplierComparisonViewSchema} from '../lib/workflow/supplier-comparisons.ts';
let f; test.before(async()=>{f=await createCommercialFixture();}); test.after(async()=>f?.close());
const review = id => f.command('commercial_review_command','quote.review',{quote_id:id});
test('86: saved totals reconcile with per-line rounded tax and explicit billing quantities',async()=>{
  await f.actor(); const id=await f.newQuote(); const data=commercialReviewSchema.parse(await review(id));
  assert.equal(data.grand_total,data.subtotal+data.tax); assert.equal(data.difference,0); assert.equal(data.items[0].physical_kg,48);
  assert.ok(data.cost>0); assert.equal(data.line_count,1); assert.deepEqual(commercialReviewProblems(data),[]);
});
test('86: restricted readers receive no cost or margin keys',async()=>{
  await f.actor(); const id=await f.newQuote();
  for(const role of ['sales','accounts','viewer']){await f.actor(f.ids[role]);const data=commercialReviewSchema.parse(await review(id));for(const key of ['cost','profit','margin_percent'])assert.equal(key in data,false);}
});
test('86: roles, active identity, tenant and payload are checked at the database boundary',async()=>{
  await f.actor();const id=await f.newQuote();
  await f.actor(f.ids.dealer);await assert.rejects(review(id),/not permitted/);
  await f.actor(f.ids.production);await assert.rejects(review(id),/not permitted/);
  await f.actor();await assert.rejects(review(cid(999)),/unavailable/);
  await assert.rejects(f.command('commercial_review_command','quote.review',{quote_id:id,company_id:f.ids.foreign}),/Invalid/);
});
test('87: review fingerprint rejects a changed accepted quotation and allows exact retry',async()=>{
  await f.actor();const id=await f.newQuote();
  await f.db.query("update quotes set status='internal_review' where id=$1",[id]);
  await f.db.query("update quotes set status='approved_for_sending',approved_by=$2,approved_at=now() where id=$1",[id,f.ids.owner]);
  await f.db.query("update quotes set status='sent' where id=$1",[id]);
  await f.db.query("update quotes set status='customer_approved' where id=$1",[id]);
  const data=await review(id), request={quote_id:id,fingerprint:data.fingerprint,request_id:cid(100)};
  await assert.rejects(f.command('commercial_review_command','quote.convert',{...request,fingerprint:'0'.repeat(32)}),/changed/);
  const first=await f.command('commercial_review_command','quote.convert',request);
  const second=await f.command('commercial_review_command','quote.convert',request);
  assert.equal(first.order_id,second.order_id);assert.equal(second.replayed,true);
  const row=(await f.db.query('select * from quote_conversion_reviews where quote_id=$1',[id])).rows[0];
  assert.equal(row.accepted_snapshot.quote.revision_number,data.revision_number);assert.equal(row.accepted_snapshot.items.length,1);
  assert.equal((await f.db.query('select count(*)::int n from orders where quote_id=$1',[id])).rows[0].n,1);
  await assert.rejects(f.db.query("update quote_conversion_reviews set revision_number=99 where quote_id=$1",[id]),/history/);
});
test('87: conversion refuses draft, malformed review identity and financial read-only actors',async()=>{
  await f.actor();const id=await f.newQuote(),data=await review(id);
  const input={command:'quote.convert',quote_id:id,fingerprint:data.fingerprint,request_id:cid(101)};
  assert.equal(commercialReviewCommandSchema.safeParse({...input,order_value:1}).success,false);
  await assert.rejects(f.command('commercial_review_command','quote.convert',input),/Invalid/);
  const {command,...payload}=input;
  await assert.rejects(f.command('commercial_review_command',command,payload),/customer-approved/);
  await f.actor(f.ids.accounts);await assert.rejects(f.command('commercial_review_command',command,payload),/not permitted/);
});
test('81: site precedence, explicit overrides and issued snapshots retain their exact party data',async()=>{
  await f.actor();const id=await f.newQuote(),project=cid(200);
  await f.db.query(`insert into customer_projects(id,company_id,customer_id,project_code,name,site_address,contact_name,status,created_by,updated_by) values($1,$2,$3,'SITE-1','Mumbai project','Mumbai delivery site','Site supervisor','active',$4,$4)`,[project,f.ids.company,f.ids.customer,f.ids.owner]);
  const payload={quote_id:id,project_id:project,overrides:{payment_terms:'Advance before dispatch'}};
  const preview=partyViewSchema.parse(await f.command('quote_party_command','party.preview',payload));
  assert.equal(preview.party.delivery_address,'Mumbai delivery site');assert.equal(preview.party.billing_address,'Billing address');assert.equal(preview.party.payment_terms,'Advance before dispatch');
  const saved=await f.command('quote_party_command','party.save',{...payload,source_fingerprint:preview.source_fingerprint,quote_fingerprint:preview.quote_fingerprint});
  assert.notEqual(saved.quote_fingerprint,preview.quote_fingerprint);
  await f.db.query("update quotes set status='internal_review' where id=$1",[id]);
  await f.db.query("update quotes set status='approved_for_sending',approved_by=$2,approved_at=now() where id=$1",[id,f.ids.owner]);
  await f.db.query("update customers set billing_address='Later master address' where id=$1",[f.ids.customer]);
  const issued=partyViewSchema.parse(await f.command('quote_party_command','party.load',{quote_id:id}));
  assert.equal(issued.immutable,true);assert.equal(issued.party.billing_address,'Billing address');
  await assert.rejects(f.command('quote_party_command','party.save',{...payload,source_fingerprint:preview.source_fingerprint,quote_fingerprint:preview.quote_fingerprint}),/immutable/);
  await f.db.query("update quotes set status='draft' where id=$1",[id]);
  const reopened=partyViewSchema.parse(await f.command('quote_party_command','party.load',{quote_id:id}));
  assert.equal(reopened.immutable,true);assert.equal(reopened.party.billing_address,'Billing address');
  await assert.rejects(f.command('quote_party_command','party.save',{...payload,source_fingerprint:preview.source_fingerprint,quote_fingerprint:preview.quote_fingerprint}),/immutable/);
});
test('81: master changes invalidate previews and issuing a reviewed stale party is refused',async()=>{
  await f.actor();const id=await f.newQuote(),payload={quote_id:id,project_id:null,overrides:{}};
  const preview=await f.command('quote_party_command','party.preview',payload);
  await f.db.query("update customers set contact_person='New contact' where id=$1",[f.ids.customer]);
  await assert.rejects(f.command('quote_party_command','party.save',{...payload,source_fingerprint:preview.source_fingerprint,quote_fingerprint:preview.quote_fingerprint}),/sources changed/);
  const fresh=await f.command('quote_party_command','party.preview',payload);
  await f.command('quote_party_command','party.save',{...payload,source_fingerprint:fresh.source_fingerprint,quote_fingerprint:fresh.quote_fingerprint});
  await f.db.query("update customers set contact_person='Another contact' where id=$1",[f.ids.customer]);
  await f.db.query("update quotes set status='internal_review' where id=$1",[id]);
  await assert.rejects(f.db.query("update quotes set status='approved_for_sending' where id=$1",[id]),/Party or site details changed/);
});
test('81: foreign sites, extra identity fields and sales draft mutations are refused',async()=>{
  await f.actor();const id=await f.newQuote();
  await assert.rejects(f.command('quote_party_command','party.preview',{quote_id:id,project_id:cid(999),overrides:{}}),/active site/);
  assert.equal(quotePartyCommandSchema.safeParse({command:'party.load',quote_id:id,company_id:f.ids.foreign}).success,false);
  await f.actor(f.ids.sales);await assert.rejects(f.command('quote_party_command','party.save',{quote_id:id}),/not permitted/);
});
test('86: line-specific GST is authoritative when the quotation header is recalculated',async()=>{
  await f.actor();const id=await f.newQuote({gst_percent:5});
  const data=await review(id);assert.equal(data.tax,Math.round(data.subtotal*5)/100);assert.equal(data.difference,0);
});
test('82: independent approval, sole-option selection and explicit multiple-option selection',async()=>{
  await f.actor();const alloy=cid(270),temper=cid(271),temper2=cid(272),option=cid(273),option2=cid(274),profile_id=f.ids.profile;
  await f.db.query("insert into pcda_master_alloys(id,company_id,value) values($1,$2,'6063')",[alloy,f.ids.company]);
  await f.db.query("insert into pcda_master_tempers(id,company_id,value) values($1,$3,'T6'),($2,$3,'T5')",[temper,temper2,f.ids.company]);
  const command=(name,payload)=>f.command('profile_technical_command',name,{profile_id,...payload});
  await command('option.create',{id:option,alloy_id:alloy,temper_id:temper});
  await assert.rejects(command('option.approve',{id:option}),/Another qualified/);
  await f.actor(f.ids.admin);await command('option.approve',{id:option});await f.actor();
  const options=technicalOptionsSchema.parse(await command('options.list',{}));assert.equal(soleTechnicalOption(options).id,option);
  const id=await f.newQuote();const line=(await f.db.query('select technical_option_id,technical_spec_snapshot,temper_id from quote_items where quote_id=$1',[id])).rows[0];
  assert.equal(line.technical_option_id,option);assert.equal(line.technical_spec_snapshot.temper,'T6');assert.equal(line.temper_id,temper);
  await command('option.create',{id:option2,alloy_id:alloy,temper_id:temper2});await f.actor(f.ids.admin);await command('option.approve',{id:option2});await f.actor();
  await assert.rejects(f.newQuote(),/Choose an approved/);assert.ok(await f.newQuote({technical_option_id:option2}));
  await f.db.query("update aluminium_profiles set drawing_revision='B' where id=$1",[profile_id]);
  await assert.rejects(f.newQuote({technical_option_id:option}),/stale or unavailable/);
  assert.equal((await f.db.query('select technical_spec_snapshot from quote_items where quote_id=$1',[id])).rows[0].technical_spec_snapshot.drawing_revision,'A');
  await f.db.query("update aluminium_profiles set drawing_revision='A' where id=$1",[profile_id]);
  await command('option.withdraw',{id:option2});
});
test('82: stale approvals, source scope and immutable option content are guarded',async()=>{
  await f.actor();const profile_id=f.ids.profile;
  await assert.rejects(f.command('profile_technical_command','option.create',{profile_id,id:cid(279),alloy_id:cid(999),temper_id:cid(271)}),/active company/);
  await assert.rejects(f.db.query("update profile_technical_options set snapshot='{}' where id=$1",[cid(273)]),/history/);
  await f.actor(f.ids.dealer);await assert.rejects(f.command('profile_technical_command','options.list',{profile_id}),/not permitted/);
});
test('82: changed or inactive alloy/temper masters invalidate new selection while historical instructions remain intact',async()=>{
  await f.actor();const quote=await f.newQuote(),profile_id=f.ids.profile;
  await f.db.query("update pcda_master_tempers set value='T66' where id=$1",[cid(271)]);
  await assert.rejects(f.newQuote({technical_option_id:cid(273)}),/stale or unavailable/);
  assert.equal((await f.db.query('select technical_spec_snapshot from quote_items where quote_id=$1',[quote])).rows[0].technical_spec_snapshot.temper,'T6');
  await f.db.query("update pcda_master_tempers set value='T6',is_active=false where id=$1",[cid(271)]);
  const data=technicalOptionsSchema.parse(await f.command('profile_technical_command','options.list',{profile_id}));assert.equal(data.eligible_count,0);assert.equal(data.items.find(row=>row.id===cid(273)).current_source,false);
  await f.db.query('update pcda_master_tempers set is_active=true where id=$1',[cid(271)]);
});
test('12: suggestions use authoritative remaining stock, specification, QC and die ownership',async()=>{
  await f.actor();const batch=cid(310),die=cid(311),profile_id=f.ids.profile;
  await f.db.query(`insert into profile_stock_batches(id,company_id,profile_id,finish,piece_length_m,length_m,quantity_pieces,total_weight_kg,location,status,origin_type,qc_status,alloy,temper)
    values($1,$2,$3,'mill_finish',6,60,10,48,'Shed B / Rack 4','available','legacy_unverified','not_required','6063','T6')`,[batch,f.ids.company,profile_id]);
  await f.db.query("insert into dies(id,company_id,profile_id,die_number,die_status,ownership_type,rack_location) values($1,$2,$3,'D-COMM','active','company_owned','Die rack 2')",[die,f.ids.company,profile_id]);
  const input={profile_id,finish:'mill_finish',cut_length_m:6,customer_id:f.ids.customer};
  const suggest=async()=>materialSuggestionsSchema.parse((await f.db.query('select public.material_suggestion_command($1) data',[input])).rows[0].data);
  const initial=await suggest();assert.equal(initial.stock[0].eligible,true);assert.equal(initial.stock[0].available.weight_kg,48);assert.equal(initial.dies[0].reason,null);
  const order=(await f.db.query('select id from orders where company_id=$1 order by created_at,id limit 1',[f.ids.company])).rows[0].id;
  await f.db.query(`insert into profile_stock_reservations(id,company_id,profile_stock_batch_id,profile_id,order_id,reserved_weight_kg,reserved_length_m,reserved_pieces,status,created_by)
    values($1,$2,$3,$4,$5,24,30,5,'active',$6)`,[cid(312),f.ids.company,batch,profile_id,order,f.ids.owner]);
  const reserved=await suggest();assert.equal(reserved.stock[0].available.weight_kg,24);assert.notEqual(initial.stock[0].fingerprint,reserved.stock[0].fingerprint);
  await assert.rejects(f.db.query(`insert into profile_stock_reservations(id,company_id,profile_stock_batch_id,profile_id,order_id,reserved_weight_kg,reserved_length_m,reserved_pieces,status,created_by)
    values($1,$2,$3,$4,$5,28.8,36,6,'active',$6)`,[cid(313),f.ids.company,batch,profile_id,order,f.ids.owner]),/stock|available|reserv|capacity|balance/i);
  await f.db.query("update profile_stock_batches set qc_status='on_hold' where id=$1",[batch]);assert.match((await suggest()).stock[0].reason,/Quality/);
  await f.db.query("update profile_stock_batches set qc_status='not_required',temper='T5' where id=$1",[batch]);assert.match((await suggest()).stock[0].reason,/temper/);
  await f.db.query("update dies set ownership_type='customer_owned',customer_id=null where id=$1",[die]);assert.match((await suggest()).dies[0].reason,/ownership/);
});
test('34: real-schema progress distinguishes recorded zeroes and hides finance from production',async()=>{
  await f.actor();const order=(await f.db.query('select id from orders where company_id=$1 order by created_at,id limit 1',[f.ids.company])).rows[0].id;
  const read=async()=>transactionProgressSchema.parse((await f.db.query('select public.order_transaction_progress($1) data',[order])).rows[0].data);
  const owner=await read();assert.equal(owner.produced_kg,0);assert.equal(owner.confirmed_outward_kg,0);assert.equal(owner.financials.invoice_count,0);
  await f.actor(f.ids.production);const production=await read();assert.equal('financials'in production,false);assert.equal(production.current_stage,owner.current_stage);
  await f.actor(f.ids.dealer);await assert.rejects(read(),/not permitted/);
});
test('36: one approved source is linked once, role-projected and rechecked at open',async()=>{
  await f.actor();const quote=await f.newQuote(),doc=cid(350),secret=cid(351),path=`${f.ids.company}/profile/${f.ids.profile}/drawing.pdf`;
  await f.db.query(`insert into technical_documents(id,company_id,document_type,linked_entity_type,linked_entity_id,file_name,file_url,storage_bucket,storage_path,version_number,approval_status)
    values($1,$3,'profile_drawing','profile',$4,'Approved drawing.pdf',$5,'documents',$5,2,'approved'),($2,$3,'costing_sheet','profile',$4,'Private costing.pdf',$5,'documents',$5,1,'approved')`,[doc,secret,f.ids.company,f.ids.profile,path]);
  const target={entity_type:'quote',entity_id:quote},link={...target,id:cid(352),document_id:doc,purpose:'Approved section drawing'};
  const command=(name,payload)=>f.command('linked_document_command',name,{...target,...payload});
  const first=await command('document.link',link);assert.equal((await command('document.link',link)).id,first.id);
  const open=await command('document.open',{document_id:doc});assert.equal(open.path,path);assert.equal(open.bucket,'documents');
  await command('document.link',{id:cid(353),document_id:secret,purpose:'Internal cost evidence'});
  await f.actor(f.ids.sales);const list=linkedDocumentsSchema.parse(await command('document.list',{}));assert.equal(list.items.length,1);assert.equal(list.items[0].document_id,doc);
  await assert.rejects(command('document.open',{document_id:secret}),/unavailable/);
  await f.actor();await f.db.query("update technical_documents set approval_status='withdrawn' where id=$1",[doc]).catch(async()=>{await f.db.query("update technical_documents set approval_status='superseded' where id=$1",[doc]);});
  await assert.rejects(command('document.open',{document_id:doc}),/unavailable/);
  assert.equal((await command('document.link',link)).id,first.id,'an exact recorded retry remains identifiable after source withdrawal');
  await assert.rejects(f.db.query("update record_document_links set purpose='Rewrite' where id=$1",[first.id]),/history/);
});
test('36: unrelated documents and foreign storage paths cannot become downloadable links',async()=>{
  await f.actor();const quote=await f.newQuote(),doc=cid(355),target={entity_type:'quote',entity_id:quote};
  await f.db.query(`insert into technical_documents(id,company_id,document_type,linked_entity_type,linked_entity_id,file_name,file_url,version_number,approval_status) values($1,$2,'profile_drawing','profile',$3,'Foreign path.pdf',$4,1,'approved')`,[doc,f.ids.company,f.ids.profile,`${f.ids.foreign}/file.pdf`]);
  await f.command('linked_document_command','document.link',{...target,id:cid(356),document_id:doc,purpose:'Path validation example'});
  await assert.rejects(f.command('linked_document_command','document.open',{...target,document_id:doc}),/storage reference/);
  await assert.rejects(f.command('linked_document_command','document.link',{...target,id:cid(357),document_id:cid(999),purpose:'Unrelated source'}),/unavailable/);
  await f.db.query(`insert into technical_documents(id,company_id,document_type,linked_entity_type,linked_entity_id,file_name,file_url,version_number,approval_status) values($1,$2,'profile_drawing','profile',$3,'Missing approval.pdf',$4,1,null)`,[cid(358),f.ids.company,f.ids.profile,`${f.ids.company}/file.pdf`]);
  await assert.rejects(f.command('linked_document_command','document.link',{...target,id:cid(359),document_id:cid(358),purpose:'Must have actual approval'}),/unavailable/);
});
test('55: normalize supplier units and preserve unknown freight instead of ranking it as zero',async()=>{
  await f.actor();const request=cid(400),vendor=cid(401),offer=cid(402),unknown=cid(403);
  await f.db.query("insert into vendors(id,company_id,vendor_name,vendor_type) values($1,$2,'Aluminium supplier','aluminum_billets')",[vendor,f.ids.company]);
  const command=(name,payload)=>f.command('supplier_comparison_command',name,payload);
  const requirement={id:request,title:'6063 billet purchase',specification:'6063 T6, 7 inch billet, material certificate',unit:'kg',quantity:1000,required_by:'2099-01-01'};
  await command('request.create',requirement);assert.equal((await command('request.create',requirement)).id,request);
  const payload={id:offer,request_id:request,vendor_id:vendor,source_reference:'SUP-2026-001',document_id:null,offered_quantity:1,unit:'tonne',unit_rate:250000,freight_mode:'excluded',freight_amount:2000,gst_percent:18,freight_gst_percent:5,delivery_date:'2098-12-01',valid_until:'2098-12-15',payment_terms:'30 days',specification_matches:true,exclusions:''};
  await command('offer.create',payload);assert.equal((await command('offer.create',payload)).id,offer);
  await command('offer.create',{...payload,id:unknown,freight_amount:null});
  const view=supplierComparisonViewSchema.parse(await command('request.load',{request_id:request}));
  const normalized=view.offers.find(row=>row.id===offer),missing=view.offers.find(row=>row.id===unknown);
  assert.equal(normalized.normalized_quantity,1000);assert.equal(normalized.normalized_rate,250);assert.equal(normalized.landed_before_tax,252000);assert.equal(normalized.tax,45100);assert.equal(normalized.cash_total,297100);assert.equal(normalized.price_basis_matches,true);
  assert.equal(missing.landed_before_tax,null);assert.equal(missing.price_basis_matches,false);assert.match(missing.reasons.join(),/Freight/);
  await assert.rejects(command('recommendation.record',{id:cid(404),request_id:request,offer_id:unknown,reason:'Cheapest apparent supplier'}),/unmatched/);
  const decision={id:cid(405),request_id:request,offer_id:offer,reason:'Matching certificate, known freight and acceptable delivery terms'};
  await command('recommendation.record',decision);assert.equal((await command('recommendation.record',decision)).id,decision.id);
  await assert.rejects(command('offer.create',{...payload,unit_rate:1}),/different details/);
});
test('55: incompatible units, expired conditions, false specifications and private rates stay controlled',async()=>{
  await f.actor();const base=(await f.db.query('select payload from supplier_comparison_offers where id=$1',[cid(402)])).rows[0].payload;
  await f.command('supplier_comparison_command','offer.create',{...base,id:cid(410),unit:'m',valid_until:'2000-01-01',specification_matches:false,exclusions:'Certificate not included'});
  const view=await f.command('supplier_comparison_command','request.load',{request_id:cid(400)}),offer=view.offers.find(row=>row.id===cid(410));
  assert.equal(offer.landed_before_tax,null);assert.ok(offer.reasons.length>=4);
  await assert.rejects(f.command('supplier_comparison_command','offer.create',{...base,id:cid(411),vendor_id:cid(999)}),/active company vendor/);
  await assert.rejects(f.command('supplier_comparison_command','offer.create',{...base,id:cid(412),document_id:cid(355)}),/source document is unavailable/);
  await f.actor(f.ids.production);await assert.rejects(f.command('supplier_comparison_command','request.load',{request_id:cid(400)}),/not permitted/);
});
test('new commercial tables and RPCs retain RLS, private helpers and no direct client access',async()=>{
  await f.actor();
  const tables=['quote_conversion_reviews','quote_party_drafts','quote_party_snapshots','profile_technical_options','record_document_links','supplier_comparison_requests','supplier_comparison_offers','supplier_comparison_recommendations','order_quote_snapshots'];
  const rows=(await f.db.query(`select relname,relrowsecurity,has_table_privilege('authenticated',oid,'SELECT,INSERT,UPDATE,DELETE') direct_access from pg_class where relnamespace='public'::regnamespace and relname=any($1)`,[tables])).rows;
  assert.equal(rows.length,tables.length);for(const row of rows){assert.equal(row.relrowsecurity,true,row.relname);assert.equal(row.direct_access,false,row.relname);}
  for(const signature of ['commercial_review_command(text,jsonb)','quote_party_command(text,jsonb)','profile_technical_command(text,jsonb)','material_suggestion_command(jsonb)','order_transaction_progress(uuid)','linked_document_command(text,jsonb)','supplier_comparison_command(text,jsonb)']){
    const acl=(await f.db.query("select has_function_privilege('anon',$1,'EXECUTE') a,has_function_privilege('authenticated',$1,'EXECUTE') u",[`public.${signature}`])).rows[0];assert.deepEqual(acl,{a:false,u:true},signature);
  }
  const helpers=(await f.db.query(`select proname,has_function_privilege('authenticated',p.oid,'EXECUTE') executable from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and proname=any($1)`,[['commercial_actor','commercial_quote_fingerprint','keep_commercial_history','reconcile_draft_quote_tax','quote_party_population','capture_quote_party_issue','technical_profile_snapshot','technical_option_fingerprint','lock_technical_option_masters','guard_technical_option_history','bind_quote_technical_option','linked_document_target','linkable_document','supplier_offer_basis','capture_accepted_order_source','apply_accepted_invoice_party']])).rows;
  assert.equal(helpers.length,16);for(const helper of helpers)assert.equal(helper.executable,false,helper.proname);
});
test('81/87: existing conversion checks the opened revision, retains accepted sources and preserves the factory queue',async()=>{
  await f.actor();const quote=await f.newQuote();
  for(const status of ['internal_review','approved_for_sending','sent','customer_approved'])await f.db.query('update quotes set status=$2 where id=$1',[quote,status]);
  const row=(await f.db.query('select revision_number,updated_at::text from quotes where id=$1',[quote])).rows[0];
  const convert=(revision,at)=>f.db.query(`select public.create_order_from_quote_with_dealer_workflow_atomic($1,null,'2026-10-28',null,'normal',0,null,'queue',null,$2,$3) id`,[quote,revision,at]);
  await assert.rejects(convert(row.revision_number+1,row.updated_at),/quotation changed/);
  const order=(await convert(row.revision_number,row.updated_at)).rows[0].id;
  assert.equal((await convert(row.revision_number,row.updated_at)).rows[0].id,order);
  const snapshot=(await f.db.query('select * from order_quote_snapshots where order_id=$1',[order])).rows[0];
  assert.equal(snapshot.quote_snapshot.status,'customer_approved');assert.equal(snapshot.line_snapshots.length,1);assert.equal(snapshot.party_snapshot.customer_id,f.ids.customer);
  assert.equal((await f.db.query('select status from factory_load_consolidations where order_id=$1',[order])).rows[0].status,'pending');
  await assert.rejects(f.db.query("update order_quote_snapshots set revision_number=999 where order_id=$1",[order]),/history/);
});
test('81: new invoices inherit the accepted party snapshot and retain it after customer changes',async()=>{
  await f.actor();const source=(await f.db.query('select * from order_quote_snapshots order by recorded_at,order_id limit 1')).rows[0];
  await f.db.query("update companies set gst_state_code='27' where id=$1",[f.ids.company]);
  const expected=source.party_snapshot.billing_address;
  await f.db.query("update customers set billing_address='A later master address' where id=$1",[f.ids.customer]);
  const invoice=(await f.db.query("insert into invoices(company_id,customer_id,order_id,invoice_number,invoice_date,status,place_of_supply_state_code) values($1,$2,$3,'SNAPSHOT-TEST','2026-10-28','draft','27') returning id,customer_snapshot",[f.ids.company,f.ids.customer,source.order_id])).rows[0];
  assert.equal(invoice.customer_snapshot.billing_address,expected);assert.equal(invoice.customer_snapshot.source_quote_id,source.quote_id);
  await f.db.query("update customers set billing_address='Yet another address' where id=$1",[f.ids.customer]);
  assert.equal((await f.db.query('select customer_snapshot from invoices where id=$1',[invoice.id])).rows[0].customer_snapshot.billing_address,expected);
  await assert.rejects(f.db.query("update invoices set customer_snapshot='{}' where id=$1",[invoice.id]),/immutable/);
});
