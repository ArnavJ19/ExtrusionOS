import {createServer} from 'node:http';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';
import {build} from 'esbuild';import postcss from 'postcss';import tailwindcss from 'tailwindcss';import loadConfig from 'tailwindcss/loadConfig.js';
import {createCommercialFixture,cid} from './commercial-upgrade-fixture.mjs';
export async function createCommercialBrowserFixture(){
  const f=await createCommercialFixture();let draft,accepted,order,request;let activeRole='owner',queue=Promise.resolve();
  const roleId=role=>f.ids[role]??f.ids.owner;
  const tables=new Set(['customers','aluminium_profiles','dies','quotes_authorized','quote_items_authorized','company_settings_authorized']);
  async function query(input){if(!tables.has(input.table))throw Error('Unexpected fixture table');
    const rows=(await f.db.query(`select to_jsonb(r) row from public.${input.table} r`)).rows.map(row=>row.row)
      .filter(row=>(input.filters??[]).every(([kind,key,value])=>kind==='in'?value.includes(row[key]):row[key]===value));
    const ordered=[...rows];for(const [key,ascending]of [...(input.orders??[])].reverse())ordered.sort((a,b)=>(ascending?1:-1)*String(a[key]??'').localeCompare(String(b[key]??'')));
    const data=input.limit?ordered.slice(0,input.limit):ordered;return {data:input.single?data[0]??null:data,error:null};
  }
  const client={from(table){const input={table,filters:[],orders:[]};const chain={select(){return chain},eq(k,v){input.filters.push(['eq',k,v]);return chain},in(k,v){input.filters.push(['in',k,v]);return chain},order(k,o){input.orders.push([k,o?.ascending!==false]);return chain},maybeSingle(){input.single=true;return chain},then(yes,no){return query(input).then(yes,no)}};return chain;},async rpc(name,p){
    if(name!=='save_quote_atomic')throw Error('Unexpected fixture write');try{return {data:(await f.db.query('select public.save_quote_atomic($1,$2,$3,$4,$5,$6) id',[p.p_quote_id,p.p_quote,p.p_items,p.p_expected_revision,p.p_expected_updated_at,p.p_revision_reason])).rows[0].id,error:null};}catch(error){return {data:null,error:{message:error.message,code:error.code}};}
  }};
  const require=createRequire(import.meta.url);require('tsx/cjs');const Module=require('node:module'),original=Module._load;
  Module._load=function(name,parent,isMain){if(name==='@/lib/auth')return {getSessionContext:async()=>({companyId:f.ids.company,userId:roleId(activeRole),role:activeRole,dealerId:null})};if(name==='@/lib/supabase/server')return {createClient:async()=>client};if(name==='next/cache')return {revalidatePath(){}};return original.call(this,name,parent,isMain);};
  let saveQuote;try{saveQuote=require('../../lib/actions/quotes-orders.ts').saveQuoteAction;}finally{Module._load=original;}
  async function reset(){await f.db.exec('begin');await f.actor();activeRole='owner';draft=await f.newQuote();accepted=await f.newQuote();
    for(const status of ['internal_review','approved_for_sending','sent','customer_approved'])await f.db.query('update quotes set status=$2 where id=$1',[accepted,status]);
    const reviewed=await f.command('commercial_review_command','quote.review',{quote_id:accepted});order=(await f.command('commercial_review_command','quote.convert',{quote_id:accepted,fingerprint:reviewed.fingerprint,request_id:cid(600)})).order_id;
    accepted=await f.newQuote();for(const status of ['internal_review','approved_for_sending','sent','customer_approved'])await f.db.query('update quotes set status=$2 where id=$1',[accepted,status]);
    await f.db.query(`insert into vendors(id,company_id,vendor_name,vendor_type) values($1,$2,'Synthetic billet supplier','aluminum_billets')`,[cid(601),f.ids.company]);
    request=cid(602);await f.command('supplier_comparison_command','request.create',{id:request,title:'6063 billet supply',specification:'6063 T6 billet, 7 inch, certificate required',unit:'kg',quantity:1000,required_by:'2099-01-01'});
    const offer={id:cid(603),request_id:request,vendor_id:cid(601),source_reference:'SYNTHETIC-OFFER-2026-01',document_id:null,offered_quantity:1,unit:'tonne',unit_rate:250000,freight_mode:'excluded',freight_amount:2000,gst_percent:18,freight_gst_percent:5,delivery_date:'2098-12-01',valid_until:'2098-12-15',payment_terms:'30 days after receipt',specification_matches:true,exclusions:''};
    await f.command('supplier_comparison_command','offer.create',offer);await f.command('supplier_comparison_command','offer.create',{...offer,id:cid(604),freight_amount:null,source_reference:'SYNTHETIC-OFFER-UNKNOWN-FREIGHT'});
    await f.db.query(`insert into technical_documents(id,company_id,document_type,linked_entity_type,linked_entity_id,file_name,file_url,storage_bucket,storage_path,approval_status,version_number)
      values($1,$2,'profile_drawing','profile',$3,'Approved synthetic drawing.pdf',$4,'documents',$4,'approved',2)`,[cid(605),f.ids.company,f.ids.profile,`${f.ids.company}/profile/${f.ids.profile}/drawing.pdf`]);
    await f.db.query(`insert into profile_stock_batches(id,company_id,profile_id,finish,piece_length_m,length_m,quantity_pieces,total_weight_kg,location,status,origin_type,qc_status,alloy,temper)
      values($1,$2,$3,'mill_finish',6,60,10,48,'Shed B / Rack 04','available','legacy_unverified','not_required','6063','T6')`,[cid(606),f.ids.company,f.ids.profile]);
  }
  const invoke=(kind,payload)=>{
    const {command,...body}=typeof payload==='object'?payload:{};
    if(kind==='quote-edit')return saveQuote(payload);
    if(kind==='material')return f.db.query('select material_suggestion_command($1) data',[payload]).then(r=>({success:true,data:r.rows[0].data}));
    if(kind==='progress')return f.db.query('select order_transaction_progress($1) data',[payload]).then(r=>({success:true,data:r.rows[0].data}));
    const rpc={commercial:'commercial_review_command',party:'quote_party_command',technical:'profile_technical_command',documents:'linked_document_command',suppliers:'supplier_comparison_command'}[kind];
    if(!rpc)throw Error('Unexpected fixture command');
    return f.command(rpc,command,body).then(data=>({success:true,kind:kind==='commercial'?(command==='quote.review'?'review':'conversion'):kind==='party'?(command==='sites.list'?'sites':'party'):kind==='technical'?(command==='options.list'?'options':command==='catalog.list'?'catalog':'saved'):kind==='documents'?(command==='document.list'?'list':command==='document.candidates'?'candidates':command==='document.open'?'url':'linked'):command==='requests.list'?'directory':command==='vendors.list'?'vendors':command==='request.load'?'comparison':'saved',data:kind==='documents'&&command==='document.open'?{url:'/synthetic-approved-file',fileName:data.file_name}:data}));
  };
  const mockAction=(name,kind)=>`export async function ${name}(payload){const response=await fetch('/command?role='+window.sessionRole,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:'${kind}',payload})});return response.json()}`;
  const aliases={
    'next/navigation':`export function useRouter(){return {push(url){window.navigations.push(url)},refresh(){}}}export function useSearchParams(){return new URLSearchParams(location.search)}`,
    'next/link':`import React from 'react';export default function Link({children,...props}){return <a {...props}>{children}</a>}`,
    'sonner':`export const toast={error(text){document.getElementById('messages').textContent=text},success(text){document.getElementById('messages').textContent=text},warning(){}}`,
    '@/lib/supabase/browser':`export function createClient(){return {from(table){const state={table,filters:[],orders:[]};const chain={select(){return chain},eq(k,v){state.filters.push(['eq',k,v]);return chain},in(k,v){state.filters.push(['in',k,v]);return chain},is(k,v){state.filters.push(['eq',k,v]);return chain},order(k,o){state.orders.push([k,o?.ascending!==false]);return chain},limit(n){state.limit=n;return chain},or(){return chain},ilike(){return chain},single(){state.single=true;return chain},maybeSingle(){state.single=true;return chain},then(yes,no){return fetch('/query?role='+window.sessionRole,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(state)}).then(r=>r.json()).then(yes,no)}};return chain},rpc:async()=>({data:null,error:{message:'Outside this fixture'}}),storage:{from(){return {createSignedUrl:async()=>({data:null,error:{message:'No artwork in this fixture'}})}}}}}`,
    '@/lib/actions/quotes-orders':mockAction('saveQuoteAction','quote-edit')+`export async function updateQuoteStatusAction(){throw Error('Not a fixture status command')}`,
    '@/lib/actions/commercial-review':mockAction('commercialReviewAction','commercial'),
    '@/lib/actions/quote-party':mockAction('quotePartyAction','party'),
    '@/lib/actions/profile-technical-options':mockAction('profileTechnicalAction','technical'),
    '@/lib/actions/transaction-evidence':mockAction('materialSuggestionsAction','material')+mockAction('orderTransactionProgressAction','progress'),
    '@/lib/actions/linked-documents':mockAction('linkedDocumentAction','documents'),
    '@/lib/actions/supplier-comparisons':mockAction('supplierComparisonAction','suppliers'),
    '@/lib/actions/costing-rates':`export async function costingRateAction(){return {success:false,error:'Outside fixture'}}`,
    '@/lib/actions/repeat-quote':`export async function repeatQuoteAction(){return {success:false,error:'Outside fixture'}}`,
    '@/lib/actions/in-task-customers':`export async function inTaskCustomerAction(){return {kind:'error',error:'Outside fixture'}}`
  };
  const bundle=await build({define:{'process.env.NODE_ENV':'"test"','process.env':'{}'},stdin:{resolveDir:process.cwd(),sourcefile:'commercial-browser.tsx',loader:'tsx',contents:`
    import React from 'react';import {createRoot} from 'react-dom/client';import {CommercialReviewPanel} from './components/modules/quotes/commercial-review';
    import {QuotePartyPanel} from './components/modules/quotes/quote-party';import {MaterialSuggestionsPanel,TransactionProgressPanel} from './components/modules/shared/transaction-evidence';
    import {LinkedDocumentsPanel} from './components/modules/shared/linked-documents';import {NewSupplierComparison,NewSupplierOffer,SupplierComparisonPanel} from './components/modules/vendors/supplier-comparisons';
    import {QuotesClient} from './components/modules/quotes-client';import {RecordNextAction} from './components/modules/shared/record-next-action';
    const root=createRoot(document.getElementById('app'));window.navigations=[];window.selectedOption='';window.mount=async()=>{const params=new URLSearchParams(location.search),data=await(await fetch('/state?'+params)).json();window.sessionRole=data.role;const context={companyId:data.company,userId:data.actor,role:data.role,dealerId:null};const screen=params.get('screen')||'review';
      root.render(<main className='mx-auto max-w-6xl space-y-5 p-4'><h1 className='text-2xl font-bold'>Synthetic factory acceptance / {screen}</h1>{screen==='edit'?<QuotesClient context={context} mode='form' initialEditId={data.draft}/>:screen==='party'?<QuotePartyPanel quoteId={data.draft} initial={data.party} canEdit={data.role==='owner'}/>:screen==='material'?<MaterialSuggestionsPanel profileId={data.profile} finish='mill_finish' cutLength={6} customerId={data.customer} scope={data.company}/>:screen==='progress'?<TransactionProgressPanel orderId={data.order} scope={data.company}/>:screen==='documents'?<LinkedDocumentsPanel entityType='quote' entityId={data.draft} canLink={data.role==='owner'}/>:screen==='supplier-new'?<NewSupplierComparison/>:screen==='offer-new'?<NewSupplierOffer requestId={data.request}/>:screen==='supplier'?<SupplierComparisonPanel initial={data.comparison}/>:<><RecordNextAction context={context} record={{kind:'quote',id:data.review.quote_id,status:data.review.status}}/><CommercialReviewPanel initial={data.review}/></>}</main>)};window.mount();
  `},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',plugins:[{name:'commercial-fixture',setup(api){for(const specifier of Object.keys(aliases))api.onResolve({filter:new RegExp('^'+specifier.replace(/[.*+?^$\{\}()|[\]\\]/g,'\\$&')+'$')},()=>({path:specifier,namespace:'fixture'}));api.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:aliases[path],loader:'tsx',resolveDir:process.cwd()}));}}]});
  const config=loadConfig(process.cwd()+'/tailwind.config.ts');const css=await postcss([tailwindcss(config)]).process(readFileSync('app/globals.css','utf8'),{from:undefined});
  const server=createServer((req,res)=>{queue=queue.then(async()=>{try{const url=new URL(req.url,'http://127.0.0.1'),role=url.searchParams.get('role')||'owner';activeRole=role;await f.actor(roleId(role));
    if(url.pathname==='/bundle.js'){res.setHeader('content-type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
    if(url.pathname==='/style.css'){res.setHeader('content-type','text/css');res.end(css.css);return;}
    if(url.pathname==='/font.woff2'){res.setHeader('content-type','font/woff2');res.end(readFileSync('node_modules/@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-400-normal.woff2'));return;}
    if(url.pathname==='/state'){const review=await f.command('commercial_review_command','quote.review',{quote_id:accepted}),party=await f.command('quote_party_command','party.load',{quote_id:draft}),comparison=await f.command('supplier_comparison_command','request.load',{request_id:request});res.setHeader('content-type','application/json');res.end(JSON.stringify({company:f.ids.company,actor:roleId(role),role,draft,accepted,order,request,profile:f.ids.profile,customer:f.ids.customer,review,party,comparison}));return;}
    if(url.pathname==='/query'||url.pathname==='/command'){let raw='';for await(const chunk of req)raw+=chunk;const input=JSON.parse(raw);let result;try{result=url.pathname==='/query'?await query(input):await invoke(input.kind,input.payload);}catch(error){result={success:false,error:error.message};}res.setHeader('content-type','application/json');res.end(JSON.stringify(result));return;}
    res.setHeader('content-type','text/html');res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><style>@font-face{font-family:Jakarta;src:url(/font.woff2)}body{font-family:Jakarta,sans-serif}</style><div id="app"></div><p id="messages" role="status"></p><script src="/bundle.js"></script>');
  }catch(error){res.statusCode=500;res.end(error.message);}});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {...f,reset,rollback:async()=>{await queue;await f.db.exec('rollback')},getDraft:()=>draft,getOrder:()=>order,getRequest:()=>request,base:`http://127.0.0.1:${server.address().port}`,close:async()=>{await new Promise(resolve=>server.close(resolve));await f.close();}};
}
