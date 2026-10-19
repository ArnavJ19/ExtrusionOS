import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import {dirname} from "node:path";
import {scrapFixture as f,scrapFixtureId as id} from "./production-scrap-fixture.mjs";

export {f as reportFixture,id as reportFixtureId};
export const reportValue=(model,label)=>model.sections.flatMap(section=>section.fields).find(field=>field.label===label)?.value;

// Actual report builder/action; only session, REST and Storage transport are synthetic.
export function createProductionReportActionFixture(){
  const state={};
  function reset(){
    Object.assign(state,{role:"production_manager",reads:[],uploads:[],history:[],caughtErrors:[],errors:{},pageCap:1000,respond:null,provider:null,
      job:{id:f.job,company_id:f.company,order_id:f.order,profile_id:f.profile,status:"completed",job_number:"BATCH-R16",
        updated_at:"2026-10-19T10:00:00Z",actual_quantity_kg:95,planned_quantity_kg:100,input_billet_weight:80,output_good_weight:70,
        scrap_weight:12,recovery_percent:87.5,scrap_percent:15},
      billets:[{id:id(101),company_id:f.company,production_job_id:f.job,status:"consumed",weight_kg:100}],
      scrap:[{id:id(201),company_id:f.company,production_job_id:f.job,weight_kg:5}]});
    return state;
  }
  reset();
  const client={auth:{getUser:async()=>({data:{user:{id:f.actor}},error:null})},from(table){
    const call={table,filters:[],select:null,count:null,sort:null,range:null};state.reads.push(call);
    const query={select(columns,options){call.select=columns;call.count=options?.count;return query;},
      eq(key,value){call.filters.push(["eq",key,value]);return query;},in(key,value){call.filters.push(["in",key,value]);return query;},
      order(key,options){call.sort={key,...options};return query;},range(start,end){call.range=[start,end];return query;},
      async single(){return read(true);},async maybeSingle(){return read(true);},
      async insert(row){assert.equal(table,"technical_reports");state.history.push(row);return {data:null,error:state.errors.history??null};},
      then(yes,no){return read(false).then(yes,no);}};
    async function read(single){
      if(table==="companies"){assert.deepEqual(call.filters,[["eq","id",f.company]]);return {data:{name:"Synthetic R16 audit company",gst_number:null},error:null};}
      if(table==="app_users"){assert.deepEqual(call.filters,[["eq","id",f.actor]]);return {data:{full_name:"Synthetic production manager",email:null},error:null};}
      assert.ok(["production_jobs_authorized","foundry_billets","scrap_records"].includes(table),table);
      assert.ok(call.filters.some(([op,key,value])=>op==="eq"&&key==="company_id"&&value===f.company),`${table}: company scope`);
      assert.ok(call.filters.some(([op,key,value])=>op==="eq"&&key===(table==="production_jobs_authorized"?"id":"production_job_id")&&value===f.job),`${table}: job scope`);
      if(state.errors[table])return {data:null,error:state.errors[table],count:null};
      let rows=state.provider?await state.provider(table):table==="production_jobs_authorized"?(state.job?[state.job]:[]):table==="foundry_billets"?state.billets:state.scrap;
      // PGlite returns Date objects; REST encodes timestamps as strings on every read.
      if(state.provider)rows=JSON.parse(JSON.stringify(rows));
      rows=rows.filter(row=>call.filters.every(([op,key,value])=>op==="in"?value.includes(row[key]):row[key]===value));
      if(call.sort)rows=[...rows].sort((a,b)=>String(a[call.sort.key]).localeCompare(String(b[call.sort.key])));
      const count=rows.length;
      if(call.range)rows=rows.slice(call.range[0],Math.min(call.range[1]+1,call.range[0]+state.pageCap));
      const result={data:structuredClone(single?rows[0]??null:rows),error:null,count:call.count==="exact"?count:null};
      return state.respond?await state.respond(call,result):result;
    }
    return query;
  },storage:{from(bucket){assert.equal(bucket,"reports");return {
    async upload(path,bytes,options){state.uploads.push({path,bytes,options});return {error:state.errors.upload??null};},
    async createSignedUrl(path){return {data:{signedUrl:`https://reports.invalid/${path}`},error:null};}
  };}}};
  const require=createRequire(import.meta.url);require("tsx/cjs");const Module=require("node:module"),original=Module._load;
  const ts=require("typescript");let customerReport;
  Module._load=function(request,parent,isMain){
    if(request==="@/lib/auth")return {getSessionContext:async()=>{if(state.role===null)throw new Error("Unauthenticated");return {companyId:f.company,role:state.role,userId:f.actor};}};
    if(request==="@/lib/supabase/server")return {createClient:async()=>client};
    if(request==="@/lib/reports/pcda/customer-report"){
      // Next compiles this dynamic import. Node's native TS loader does not resolve @ aliases.
      // Transpile the actual customer wrapper to CJS; its builder/sanitizer remain real.
      if(!customerReport){
        const filename=require.resolve("../../lib/reports/pcda/customer-report.ts"),compiledModule=new Module(filename,parent);
        compiledModule.filename=filename;compiledModule.paths=Module._nodeModulePaths(dirname(filename));
        const source=ts.transpileModule(readFileSync(filename,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
        compiledModule._compile(source,filename);customerReport=compiledModule.exports;
      }
      return customerReport;
    }
    if(request==="@/lib/utils/errors"){
      const actual=original(request,parent,isMain);return {...actual,getErrorMessage(error,...args){state.caughtErrors.push(error);return actual.getErrorMessage(error,...args);}};
    }
    return original(request,parent,isMain);
  };
  let build,generate,readiness,generators;
  try{
    build=require("../../lib/reports/pcda/builder.ts").buildReportModel;
    generate=require("../../lib/actions/pcda-reports.ts").generateReport;
    readiness=require("../../lib/reports/pcda/readiness.ts").checkReportReadiness;
    generators=require("../../lib/reports/pcda/generator.ts");
  }finally{Module._load=original;}
  return {state,reset,client,generators,build:()=>build("production_batch",f.job,f.company),
    generate:(format="pdf")=>generate("production_batch",f.job,format),readiness:()=>readiness("production_batch",f.job,f.company,client)};
}
