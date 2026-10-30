import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createBatch6Browser} from './lib/eos-batch6-browser-fixture.mjs';

const id=n=>`bc000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const out=resolve('docs/evidence/EOS_UPGRADE_BATCH_6');await mkdir(out,{recursive:true});
const release={kind:'release_state',configuration_id:id(1),status:'pending_approval',current_rules_revision:3,current_output_revision:10,
  latest:{id:id(2),revision:1,author_id:id(3),created_at:'2026-10-30T07:30:00Z',input_fingerprint:'a'.repeat(64),rules_fingerprint:'b'.repeat(64),output_fingerprint:'c'.repeat(64),rules_revision:3,output_revision:10,
    readiness:'ready',release_status:'pending_approval',unresolved_reasons:[],estimated_fields:[],approved_by:null,approved_at:null,approval_note:null,handoff_order_id:null,handed_off_at:null},unresolved_reasons:[]};
const order={id:id(1),order_number:'SO-SAMPLE-007',order_date:'2026-10-29',stage:'packing',expected_dispatch_date:'2026-11-04',delivery_address:'Sample industrial estate, Gate 2',delivery_basis:'accepted_order',
  lines:[{id:id(2),profile_code:'AL-SAMPLE-01',description:'6063 T6 window section',quantity_kg:960,pieces:200}],
  shipments:[{id:id(3),dispatch_number:'DSP-SAMPLE-01',delivery_status:'delivered',weight_kg:288}]};
const partial={kind:'progress',page:1,total:1,unlinked_packing_rows:0,basis:'Physical order basis is separate from measured packed and billed kg.',
  items:[{id:id(2),label:'AL-SAMPLE-01 / window section',ordered_kg:960,produced_kg:600,planned_open_kg:360,packed_pieces:60,packed_metres:360,packed_actual_kg:288,dispatched_actual_kg:288,billed_kg:288,remaining_to_pack_order_kg:672,unbilled_packed_kg:0}]};
const planning={company_id:id(10),from_date:'2026-10-30',through_date:'2026-11-12',today:'2026-10-30',fingerprint:'a'.repeat(32),
  machines:[{id:id(11),machine_name:'Sample press 1',status:'active',is_active:true}],
  jobs:[{id:id(12),job_number:'PJ-SAMPLE-01',order_id:id(1),order_number:'SO-SAMPLE-007',customer_name:'Sample fabricator',profile_code:'AL-SAMPLE-01',die_number:'D-SAMPLE-01',die_status:'active',billet_allocation_status:'complete',billets_short:0,status:'planned',machine_id:null,planned_quantity_kg:360,actual_quantity_kg:0,planned_date:null,finishing_type:'mill_finish',source_line_id:id(2)}],
  slots:[],shift_capacities:[{id:id(13),machine_id:id(11),weekday:5,shift_name:'Day',starts_local:'08:00',ends_local:'20:00',capacity_kg:500}],maintenance_blocks:[],finishing_lead_times:[]};
const vehicle={id:id(20),registration_number:'DL01AB1234',vehicle_label:'Sample 12T truck',capacity_kg:12000,version:1,fingerprint:'b'.repeat(32)};
const loadBundles=[1,2].map(n=>({id:id(20+n),fingerprint:String(n).repeat(32),bundle_number:`SAMPLE-BUNDLE-${n}`,order_id:id(1+n),order_number:`SO-SAMPLE-00${n+6}`,customer_id:id(30+n),customer_name:`Sample fabricator ${n}`,destination:`Sample site ${n}, Gate ${n}`,party_basis:'Accepted order snapshot',source_line_id:id(40+n),source_kind:'reservation',profile_id:id(50),net_weight_kg:288,number_of_pieces:60,net_length_m:360,source_document_quote_id:id(60+n),source_document_revision:1}));
const po={id:id(80),po_number:'PO-SAMPLE-001',vendor_id:id(81),vendor_name:'Sample billet supplier',order_date:'2026-10-29',status:'open',expected_freight_amount:20,expected_discount_amount:0,
  lines:[{id:id(82),line_number:1,description:'6063 billet',specification:'6063 T6 billet / 7 inch',unit:'kg',ordered_quantity:100,unit_rate:10,gst_percent:18,received_quantity:12,accepted_quantity:10,rejected_quantity:1,held_quantity:1,billed_quantity:0}]};
const purchasing={kind:'dashboard',vendors:[{id:po.vendor_id,vendor_name:po.vendor_name}],orders:[po],bills:[]};
const billLines=[{purchase_order_line_id:id(82),quantity:20,unit:'kg',rate:10,base_amount:200,tax_amount:36}];
const billInput={vendor_id:po.vendor_id,purchase_order_id:po.id,invoice_number:'INV-SAMPLE-001',invoice_date:'2026-10-29',due_date:null,tax_amount:36,freight_amount:20,discount_amount:0,total_amount:256,lines:billLines};
const billSource={kind:'document',id:id(83),source_name:'sample-supplier-invoice.txt',source_hash:'a'.repeat(64),review_revision:1,review_hash:'b'.repeat(32),idempotent_replay:false,
  proposal:{vendor_name:po.vendor_name,invoice_number:billInput.invoice_number,invoice_date:billInput.invoice_date,quantity:null,unit:null,rate:null,description:null,base_amount:200,tax_amount:36,freight_amount:20,discount_amount:0,total_amount:256,lines:[{description:'6063 billet',quantity:20,unit:'kg',rate:10,base_amount:200,tax_amount:36}]},uncertain_fields:[],reviewed_payload:billInput};
const billMatch={matched:false,exceptions:['Accepted receipt quantity is short for 6063 billet.'],lines:[{description:'6063 billet',unit:'kg',quantity:20,accepted_received:10,previously_billed:0,rate:10,po_rate:10,base_amount:200,tax_amount:36}],
  expected:{base_amount:200,tax_amount:36,freight_amount:20,discount_amount:0,total_amount:256},actual:{base_amount:200,tax_amount:36,freight_amount:20,discount_amount:0,total_amount:256}};
const selectedBill={kind:'bill_loaded',bill:{...billInput,id:id(84),status:'draft',match_status:'unmatched',match_snapshot:billMatch,source_hash:billSource.source_hash,review_revision:1,review_hash:billSource.review_hash,expense_ledger_id:null,source:billSource,order:po}};
const cases=[
  {name:'practice',component:'PracticeWorkspace',setup:async p=>{await p.getByRole('button',{name:'Open sample operations desk',exact:true}).click();await p.getByRole('button',{name:'Review sample transaction',exact:true}).click();}},
  {name:'configuration-release',component:'ConfigurationRelease',props:{initialState:release,configurationId:id(1),userId:id(4),canApprove:true}},
  {name:'customer-portal',component:'CustomerSelfService',results:{customerSelfServiceAction:{'orders.list':{success:true,data:{kind:'orders',items:[order]}},'order.load':{success:true,data:{kind:'order',order,version:'d'.repeat(32)}}}},setup:async p=>{await p.getByRole('button',{name:'Find your orders',exact:true}).click();await p.getByRole('button',{name:/SO-SAMPLE-007/}).click();}},
  {name:'partial-order',component:'PartialOrderProgress',props:{orderId:id(1)},results:{partialProgressAction:{success:true,data:partial}},setup:async p=>{await p.getByRole('button',{name:'Refresh line balances',exact:true}).click();await p.getByText('AL-SAMPLE-01 / window section',{exact:true}).waitFor();}},
  {name:'source-reconciliation',component:'OperationalAssurance',props:{userId:id(4),canConfigure:true,initialId:id(1)},results:{operationalAssuranceAction:{'boundary.evaluate':{success:true,data:{kind:'boundary',snapshot:{expected:288,recorded:280,unexplained:8,unit:'kg',evidence_complete:true,reconciled:false,fingerprint:'e'.repeat(32)}}}}},setup:async p=>{await p.getByRole('button',{name:'Evaluate selected record',exact:true}).click();}},
  {name:'factory-capacity',component:'FactoryPlanning',props:{initialSnapshot:planning,initialError:null,canMove:true,canConfigure:false,orders:[]}},
  {name:'vehicle-loads',component:'VehicleLoads',props:{initialSnapshot:{company_id:id(10),page:1,page_size:10,total_bundle_count:2,search:'',vehicles:[vehicle],bundles:loadBundles,loads:[],load_total_count:0,current_load:null},initialError:null,canConfigure:false}},
  {name:'purchase-entry',component:'PurchaseLifecycle',props:{initialData:purchasing,initialError:null,role:'owner'},setup:async p=>{await p.getByRole('button',{name:'New purchase order',exact:true}).click();await p.locator('form select').first().selectOption(po.vendor_id);}},
  {name:'purchase-receiving',component:'PurchaseLifecycle',props:{initialData:purchasing,initialError:null,role:'owner'},setup:async p=>{await p.getByRole('button',{name:'Record this receipt',exact:true}).click();for(const [label,value]of [['Actual received','12'],['Accepted','10'],['Rejected','1'],['Held pending review','1']])await p.getByLabel(label,{exact:true}).fill(value);}},
  {name:'supplier-bill-review',component:'PurchaseLifecycle',props:{initialData:purchasing,initialSelection:selectedBill,initialError:null,role:'owner'}},
  {name:'connected-return',component:'ConnectedReturns',props:{dispatchId:id(3),userId:id(4),canInspect:true,canCredit:true},results:{connectedReturnAction:{'sources.list':{success:true,data:{kind:'sources',items:[{id:id(90),bundle_number:'SAMPLE-BUNDLE-1',net_weight_kg:288,number_of_pieces:60,net_length_m:360,received_kg:0}]}}}},setup:async p=>{await p.getByRole('button',{name:'Load shipped bundles',exact:true}).click();await p.getByRole('button',{name:/^SAMPLE-BUNDLE-1:/}).click();for(const[label,value]of[['Actual received kg','28.8'],['Actual received pieces','6'],['Actual received metres','36'],['Return reason','Sample return: incorrect finishing, observed at receiving']])await p.getByLabel(label,{exact:true}).fill(value);}},
  {name:'invoice-eligibility',component:'FinancialWorkflowReviewClient',props:{mode:'eligibility'},results:{searchInvoiceEligibilityOrdersAction:{success:true,rows:[{id:id(1),order_number:'SO-SAMPLE-007',customer_name:'Sample fabricator',company_name:'Sample fabricator',current_stage:'dispatched',order_value:72000}],hasMore:false},searchInvoiceEligibilityDispatchesAction:{success:true,rows:[{id:id(3),order_id:id(1),dispatch_number:'DSP-SAMPLE-01',dispatch_date:'2026-10-29',delivery_status:'delivered',total_weight_kg:288}],hasMore:false}},setup:async p=>{await p.getByLabel('Eligible order',{exact:true}).selectOption(id(1));await p.getByLabel('Eligible dispatch',{exact:true}).selectOption(id(3));}}
];
const evidence=[];
for(const c of cases){const f=await createBatch6Browser({...c,styled:true});try{
  for(const width of [1280,375]){await f.page.setViewportSize({width,height:900});await f.reset();await c.setup?.(f.page);await f.page.evaluate(()=>document.fonts.ready);
    if(c.name==='vehicle-loads'&&width===375){const table=await f.page.locator('table').first().evaluate(table=>{const viewport=table.parentElement;viewport.scrollLeft=viewport.scrollWidth;const result={scrollable:viewport.scrollWidth>viewport.clientWidth,scrolled:viewport.scrollLeft>0,contained:viewport.getBoundingClientRect().right<=innerWidth};viewport.scrollLeft=0;return result;});assert.deepEqual(table,{scrollable:true,scrolled:true,contained:true},'Phone bundles retain usable horizontal scrolling inside the card');}
    const file=`${c.name}-${width===375?'phone':'desktop'}.png`;await f.page.screenshot({path:resolve(out,file),fullPage:true});
    const overflow=await f.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
    assert.equal(overflow,false,`${c.name} body overflow at ${width}`);assert.deepEqual(f.errors,[]);assert.deepEqual(f.network,[]);
    evidence.push({component:c.component,width,file,bodyOverflow:overflow,runtimeErrors:[...f.errors],outsideRequests:[...f.network]});
  }
}finally{await f.close();}}
await writeFile(resolve(out,'visual-checks.json'),JSON.stringify({layer:'Mounted real components with mocked actions and production CSS; no authenticated hosted acceptance',cases:evidence},null,2)+'\n');
console.log(`Captured ${evidence.length} styled desktop/phone screenshots without body overflow, runtime errors or outside requests.`);
