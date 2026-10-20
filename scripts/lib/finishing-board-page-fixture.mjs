import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {renderToStaticMarkup,renderToString} from 'react-dom/server';
import {createElement} from 'react';
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {partialFinishingIds as f} from './finishing-partial-retry-fixture.mjs';

export function createFinishingBoardPageFixture({island=false,originalPage=false}={}){
  const state={role:'production_manager',queries:[],calls:[],rows:[],vendors:[],errors:{},cap:1000,respond:null,rpcOverride:null};
  const client={async rpc(name,args){state.calls.push({name,args});if(state.rpcOverride)return state.rpcOverride(name,args);return {data:null,error:{message:'Synthetic workload reader unavailable'}};},from(table){
    const call={table,filters:[],sort:[],limit:null,range:null,count:false};state.queries.push(call);
    const query={select(columns,options){call.columns=columns;call.count=options?.count==='exact';return query;},eq(key,value){call.filters.push(['eq',key,value]);return query;},
      in(key,value){call.filters.push(['in',key,value]);return query;},order(key,options={}){call.sort.push({key,...options});return query;},limit(value){call.limit=value;return query;},range(start,end){call.range=[start,end];return query;},
      then(yes,no){return Promise.resolve(read()).then(yes,no);}};
    function read(){assert.ok(call.filters.some(([op,key,value])=>op==='eq'&&key==='company_id'&&value===f.company),'Company scope');
      let rows=table==='finishing_jobs'?state.rows:table==='vendors'?state.vendors:[];
      rows=rows.filter(row=>call.filters.every(([kind,key,value])=>kind==='in'?value.includes(row[key]):row[key]===value));
      const count=rows.length;rows=[...rows].sort((a,b)=>{for(const {key,ascending=true,nullsFirst=false} of call.sort){const left=a[key],right=b[key];if(left===right)continue;
        if(left==null)return nullsFirst?-1:1;if(right==null)return nullsFirst?1:-1;return (String(left)<String(right)?-1:1)*(ascending?1:-1);}return 0;});
      const start=call.range?.[0]??0,limit=call.range?call.range[1]-start+1:call.limit??count;rows=rows.slice(start,start+Math.min(limit,state.cap));
      const key=call.filters.some(([,name])=>name==='retry_of_finishing_job_id')?'retries':table;
      const result=state.errors[key]?{data:null,error:state.errors[key],count:null}:{data:structuredClone(rows),error:null,count:call.count?count:null};
      return state.respond?state.respond(call,result):result;
    }
    return query;
  }};
  const require=createRequire(import.meta.url);require('tsx/cjs');const Module=require('node:module'),original=Module._load;
  Module._load=function(request,parent,isMain){
    if(request==='@/lib/auth')return {getSessionContext:async()=>{if(state.role===null)throw new Error('Unauthenticated');return {companyId:f.company,userId:f.actor,role:state.role};}};
    if(request==='@/lib/supabase/server')return {createClient:async()=>client};
    if(request==='next/navigation')return {redirect(path){throw new Error(`redirect:${path}`);},useRouter:()=>({refresh(){},push(){}})};
    if(request==='@/lib/actions/finishing')return {transitionFinishingJobAction:()=>assert.fail('Read-only page fixture'),retryRejectedFinishingJobAction:()=>assert.fail('Read-only page fixture')};
    if(island&&request==='@/components/modules/finishing-workflow-board'){
      const actual=original(request,parent,isMain);return {FinishingWorkflowBoard(props){state.boardProps=props;return createElement('section',{id:'finishing-workflow-island'},createElement(actual.FinishingWorkflowBoard,props));}};
    }
    return original(request,parent,isMain);
  };
  let Page,DatabasePage,ReceiptPage;
  try{const load=path=>{const file=require.resolve(path);delete require.cache[file];return require(file).default;};
    if(originalPage){const path=require.resolve('../../app/(dashboard)/production/finishing/page.tsx'),compiledPage=new Module(path),ts=require('typescript');compiledPage.filename=path;compiledPage.paths=Module._nodeModulePaths(process.cwd());
      const git=process.platform==='win32'&&existsSync('C:/Program Files/Git/cmd/git.exe')?'C:/Program Files/Git/cmd/git.exe':'git';
      const source=execFileSync(git,['show','96fcfe9:app/(dashboard)/production/finishing/page.tsx'],{encoding:'utf8'});
      compiledPage._compile(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,path);Page=compiledPage.exports.default;
    }else Page=load('../../app/(dashboard)/production/finishing/page.tsx');
    DatabasePage=load('../../app/(dashboard)/production/finishing/database/page.tsx');ReceiptPage=load('../../app/(dashboard)/production/finishing/[id]/page.tsx');}finally{Module._load=original;}
  const markup=island?renderToString:renderToStaticMarkup;
  return {state,client,async render(params={}){return markup(await Page({searchParams:Promise.resolve(params)}));},
    async database(params={}){return markup(await DatabasePage({searchParams:Promise.resolve(params)}));},
    async receipt(id){return markup(await ReceiptPage({params:Promise.resolve({id})}));}};
}

export function createFinishingActionFixture(sql){
  const state={role:'production_manager',calls:[],paths:[]};const client={async rpc(name,args){
    state.calls.push({name,args});await sql.db.query("select set_config('test.role',$1,false)",[state.role]);
    try{const result=await sql.attempt(()=>name==='transition_finishing_job_atomic'?sql.db.query('select public.transition_finishing_job_atomic($1,$2,$3,$4,$5,$6,$7,$8) id',
      [args.p_job_id,args.p_status,args.p_vendor_id,args.p_sent_date,args.p_received_date,args.p_output_weight_kg,args.p_rejection_weight_kg,args.p_remarks]):name==='retry_rejected_finishing_job_atomic'?sql.db.query('select public.retry_rejected_finishing_job_atomic($1,$2,$3) id',[args.p_rejected_job_id,args.p_planned_date,args.p_remarks]):assert.fail(name));return {data:result.rows[0].id,error:null};
    }catch(error){return {data:null,error:{message:error.message}};}
  }};
  const require=createRequire(import.meta.url);require('tsx/cjs');const Module=require('node:module'),original=Module._load;
  Module._load=function(request,parent,isMain){
    if(request==='@/lib/auth')return {getSessionContext:async()=>({companyId:f.company,userId:f.actor,role:state.role})};
    if(request==='@/lib/supabase/server')return {createClient:async()=>client};
    if(request==='next/cache')return {revalidatePath:(...args)=>state.paths.push(args)};
    return original(request,parent,isMain);
  };
  const file=require.resolve('../../lib/actions/finishing.ts');delete require.cache[file];let actions;try{actions=require(file);}finally{Module._load=original;}
  return {actions,state};
}

export function finishingMetric(html,label){const escaped=label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const match=html.match(new RegExp(`>${escaped}</p><p[^>]*>([^<]+)</p>`));return match?.[1]??null;}
