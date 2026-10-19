import assert from "node:assert/strict";
import test from "node:test";
import {createProductionReportActionFixture,reportFixture as f,reportFixtureId as id,reportValue as value} from "../scripts/lib/production-report-action-fixture.mjs";

const fixture=createProductionReportActionFixture(),{state,reset}=fixture;
const quantities=model=>Object.fromEntries(["Billet Weight kg","Output Good kg","Scrap kg","Recovery %","Scrap %"].map(label=>[label,value(model,label)]));
const expected={"Billet Weight kg":100,"Output Good kg":95,"Scrap kg":5,"Recovery %":95,"Scrap %":5};
const row=(n,weight,extra={})=>({id:id(n),company_id:f.company,production_job_id:f.job,weight_kg:weight,...extra});

test("production batch reports use recorded output and complete scoped material evidence",async context=>{
  await context.test("ignores stale PCDA quantities and derived snapshot percentages",async()=>{
    reset();assert.deepEqual(quantities(await fixture.build()),expected);
    assert.equal(value(await fixture.build(),"Balance Difference kg"),0);
  });
  await context.test("reads both ledgers with company/job filters, exact counts and stable pages",async()=>{
    reset();await fixture.build();
    for(const table of ["foundry_billets","scrap_records"]){
      const read=state.reads.find(call=>call.table===table);assert.ok(read,table);assert.equal(read.count,"exact");
      assert.deepEqual(read.sort,{key:"id",ascending:true});assert.deepEqual(read.range,[0,199]);
    }
  });
  await context.test("does not sum other jobs, companies or unlinked/available billets",async()=>{
    reset();state.billets.push(row(102,1000,{status:"consumed",production_job_id:id(90)}),row(103,1000,{status:"consumed",company_id:id(91)}),
      row(104,1000,{status:"available"}),row(105,1000,{status:"consumed",production_job_id:null}));
    state.scrap.push(row(202,1000,{production_job_id:id(90)}),row(203,1000,{company_id:id(91)}));
    assert.deepEqual(quantities(await fixture.build()),expected);
  });
  await context.test("includes all allocated/issued/consumed inputs used by completion validation",async()=>{
    reset();state.billets=[row(100,30,{status:"allocated"}),row(101,40,{status:"issued"}),row(102,30,{status:"consumed"})];
    assert.deepEqual(quantities(await fixture.build()),expected);
  });
  await context.test("reads 1,201 rows per ledger across a smaller server cap",async()=>{
    reset();state.pageCap=71;state.billets=Array.from({length:1201},(_,i)=>row(1000+i,1,{status:"consumed"}));
    state.scrap=Array.from({length:1201},(_,i)=>row(3000+i,0.001));state.job.actual_quantity_kg=1199.799;
    const model=await fixture.build();assert.equal(value(model,"Billet Weight kg"),1201);assert.equal(value(model,"Scrap kg"),1.201);
    assert.equal(value(model,"Balance Difference kg"),0);
    for(const table of ["foundry_billets","scrap_records"])assert.equal(state.reads.filter(call=>call.table===table).at(-1).range[0],1136);
  });
  await context.test("reports zero recorded scrap for a fully captured lossless completion",async()=>{
    reset();state.scrap=[];state.job.actual_quantity_kg=100;const model=await fixture.build();
    assert.equal(value(model,"Scrap kg"),0);assert.equal(value(model,"Scrap %"),0);assert.equal(value(model,"Recovery %"),100);
    assert.equal(value(model,"Balance Difference kg"),0);
  });
  await context.test("keeps absent legacy input unknown instead of estimating output plus scrap",async()=>{
    reset();state.billets=[];const model=await fixture.build();assert.equal(value(model,"Billet Weight kg"),"Not Captured");
    assert.equal(value(model,"Output Good kg"),95);assert.equal(value(model,"Scrap kg"),5);
    for(const label of ["Recovery %","Scrap %","Balance Difference kg"])assert.equal(value(model,label),"Not Captured");
    state.scrap=[];assert.equal(value(await fixture.build(),"Scrap kg"),"Not Captured");
  });
  await context.test("does not substitute planned/source quantities for missing final output",async()=>{
    for(const missing of [null,undefined,0,"0.000"]){
      reset();state.job.actual_quantity_kg=missing;const model=await fixture.build();
      assert.equal(value(model,"Output Good kg"),"Not Captured");assert.equal(value(model,"Recovery %"),"Not Captured");
    }
  });
  await context.test("keeps planned/in-progress/cancelled reports available without final recovery",async()=>{
    for(const status of ["planned","ready","in_progress","on_hold","cancelled"]){
      reset();state.job.status=status;state.job.actual_quantity_kg=0;assert.equal((await fixture.readiness()).ready,true);
      const model=await fixture.build();assert.equal(value(model,"Output Good kg"),"Not Captured");
      assert.equal(value(model,"Recovery %"),"Not Captured");assert.equal(value(model,"Scrap %"),"Not Captured");
      assert.match(value(model,"Reconciliation"),/pending|not completed/i);
    }
  });
  await context.test("shows a mass-balance difference instead of silently treating missing scrap as accounted loss",async()=>{
    reset();state.scrap=[];const model=await fixture.build();assert.equal(value(model,"Scrap kg"),0);
    assert.equal(value(model,"Balance Difference kg"),5);assert.match(value(model,"Reconciliation"),/review/i);
    assert.match(value(model,"Scrap Basis"),/recorded/i);
  });
  await context.test("retains measured over-output and flags it rather than clamping recovery",async()=>{
    reset();state.job.actual_quantity_kg=110;const model=await fixture.build();assert.equal(value(model,"Recovery %"),110);
    assert.equal(value(model,"Balance Difference kg"),-15);assert.match(value(model,"Reconciliation"),/review/i);
  });
  await context.test("stops a missing or failed job read before ledger reads or exports",async()=>{
    reset();state.job=null;await assert.rejects(fixture.build,/production job/i);assert.equal(state.reads.some(call=>call.table==="scrap_records"),false);
    reset();state.errors.production_jobs_authorized={message:"projection unavailable"};await assert.rejects(fixture.build,/production job/i);
  });
  for(const table of ["foundry_billets","scrap_records"]){
    await context.test(`stops on a failed ${table} read`,async()=>{
      reset();state.errors[table]={message:"read unavailable"};await assert.rejects(fixture.build);
    });
    await context.test(`stops on a later ${table} page failure`,async()=>{
      reset();state.pageCap=1;
      if(table==="foundry_billets")state.billets=[row(100,50,{status:"consumed"}),row(101,50,{status:"consumed"})];
      else state.scrap=[row(200,2),row(201,3)];
      state.respond=(call,result)=>call.table===table&&call.range?.[0]>0?{data:null,error:{message:"late page unavailable"},count:null}:result;
      await assert.rejects(fixture.build,/unavailable|history|evidence/i);
    });
    for(const variant of ["missing count","changing count","oversized count","empty page","overfull page","duplicate id","out of order","foreign company","foreign job","malformed weight","negative weight","boolean weight","unsafe weight","extra decimal"]){
      await context.test(`${table} rejects ${variant}`,async()=>{
        reset();state.pageCap=1;
        if(table==="foundry_billets")state.billets=[row(100,50,{status:"consumed"}),row(101,50,{status:"consumed"})];
        else state.scrap=[row(200,2),row(201,3)];
        let previous;
        state.respond=(call,result)=>{
          if(call.table!==table)return result;const next=structuredClone(result),offset=call.range?.[0]??0;
          if(variant==="missing count")next.count=null;
          if(variant==="changing count"&&offset>0)next.count++;
          if(variant==="oversized count")next.count=100001;
          if(variant==="empty page")next.data=[];
          if(variant==="overfull page")next.data=Array(201).fill(next.data[0]);
          if(variant==="duplicate id"){if(offset>0)next.data[0].id=previous;previous=next.data[0].id;}
          if(variant==="out of order"){next.data[0].id=offset>0?id(1):id(999);}
          if(variant==="foreign company")next.data[0].company_id=id(99);
          if(variant==="foreign job")next.data[0].production_job_id=id(99);
          if(variant==="malformed weight")next.data[0].weight_kg="not-a-weight";
          if(variant==="negative weight")next.data[0].weight_kg=-1;
          if(variant==="boolean weight")next.data[0].weight_kg=true;
          if(variant==="unsafe weight")next.data[0].weight_kg=Number.MAX_SAFE_INTEGER;
          if(variant==="extra decimal")next.data[0].weight_kg="0.0001";
          return next;
        };
        await assert.rejects(fixture.build,/history|evidence|quantity|weight|identit|range/i);
      });
    }
  }
  await context.test("rechecks job revision/output/status after reading evidence",async()=>{
    for(const change of [{updated_at:"2026-10-19T10:01:00Z"},{actual_quantity_kg:94},{status:"in_progress"},{company_id:id(99)},{profile_id:id(99)}]){
      reset();let jobReads=0;state.respond=(call,result)=>{
        if(call.table==="production_jobs_authorized"&&++jobReads===2)return {...result,data:{...result.data,...change}};return result;
      };
      await assert.rejects(fixture.build,/changed|refresh|identit/i);
    }
  });
  await context.test("sums deterministic decimal histories without a floating point balance residue",async()=>{
    let seed=9016;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
    for(let run=0;run<32;run++){
      reset();state.pageCap=1+random()%73;const input=1000+random()%1000000,scrap=1+random()%Math.floor(input/2),count=2+random()%51;
      const parts=(milli,start,status)=>Array.from({length:count},(_,i)=>row(start+i,((Math.floor(milli/count)+(i<milli%count?1:0))/1000).toFixed(3),status?{status}:{}));
      state.billets=parts(input,1000,"consumed");state.scrap=parts(scrap,3000);state.job.actual_quantity_kg=((input-scrap)/1000).toFixed(3);
      const model=await fixture.build();assert.equal(value(model,"Billet Weight kg"),input/1000);assert.equal(value(model,"Scrap kg"),scrap/1000);
      assert.equal(value(model,"Balance Difference kg"),0);
    }
  });
  await context.test("does not emit any commercial fields from the job projection",async()=>{
    reset();Object.assign(state.job,{internal_cost:123456,margin:9876,supplier_rate:8888,internal_note:"private-marker"});
    assert.doesNotMatch(JSON.stringify(await fixture.build()),/private-marker|123456|9876|8888/);
  });
  await context.test("rejects malformed actual output rather than substituting a source snapshot",async()=>{
    for(const weight of [true,"", "0x10", "1e2", "NaN", -1, "0.0001",Number.POSITIVE_INFINITY]){
      reset();state.job.actual_quantity_kg=weight;await assert.rejects(fixture.build,/weight/i);
    }
  });
  await context.test("preserves exact thousandths for large numeric fields and ordinary decimal values",async()=>{
    for(const [input,output,scrap] of [[12345678901.234,12345678900.234,1],[0.3,0.2,0.1]]){
      reset();state.billets=[row(100,input,{status:"consumed"})];state.scrap=[row(200,scrap)];state.job.actual_quantity_kg=output;
      const model=await fixture.build();assert.equal(value(model,"Billet Weight kg"),input);assert.equal(value(model,"Output Good kg"),output);
      assert.equal(value(model,"Scrap kg"),scrap);assert.equal(value(model,"Balance Difference kg"),0);
    }
  });
  await context.test("rejects aggregate and balance overflow",async()=>{
    reset();state.billets=[row(100,5000000000000,{status:"consumed"}),row(101,5000000000000,{status:"consumed"})];
    await assert.rejects(fixture.build,/range/i);
    reset();state.job.actual_quantity_kg=5000000000000;state.scrap=[row(200,5000000000000)];
    await assert.rejects(fixture.build,/range/i);
  });
  await context.test("allows an explicit zero scrap entry but rejects zero billet weight",async()=>{
    reset();state.scrap=[row(200,0)];state.job.actual_quantity_kg=100;assert.equal(value(await fixture.build(),"Scrap kg"),0);
    state.billets[0].weight_kg=0;await assert.rejects(fixture.build,/positive recorded weight/i);
  });
  await context.test("rejects malformed row identities, unexpected statuses and job identity overrides",async()=>{
    for(const change of [{id:"invalid"},{production_job_id:null},{status:"available"}]){
      reset();state.respond=(call,result)=>call.table==="foundry_billets"?{...result,data:result.data.map(row=>({...row,...change}))}:result;
      await assert.rejects(fixture.build,/evidence/i);
    }
    for(const change of [{id:id(99)},{company_id:id(99)}]){
      reset();state.respond=(call,result)=>call.table==="production_jobs_authorized"?{...result,data:{...result.data,...change}}:result;
      await assert.rejects(fixture.build,/identity/i);
    }
  });
  await context.test("generates the actual PDF through the authorized action with a scoped captured upload",async()=>{
    reset();const result=await fixture.generate();assert.equal(result.success,true,result.error);assert.equal(state.uploads.length,1);
    assert.ok(state.uploads[0].path.startsWith(`${f.company}/reports/production_job/${f.job}/`));
    assert.equal(Buffer.from(state.uploads[0].bytes).subarray(0,5).toString(),"%PDF-");
    assert.equal(state.history.length,1);assert.equal(state.history[0].company_id,f.company);assert.equal(state.history[0].record_id,f.job);
  });
  await context.test("denied roles and missing sessions stop before reading or uploading report data",async()=>{
    for(const role of ["sales","accounts","viewer","dealer_admin","quality",null]){
      reset();state.role=role;const result=await fixture.generate();assert.equal(result.success,false,role);
      assert.equal(state.reads.length,0);assert.equal(state.uploads.length,0);assert.equal(state.history.length,0);
    }
  });
  await context.test("all four existing report roles retain access",async()=>{
    for(const role of ["owner","admin","production_manager","production"]){
      reset();state.role=role;const result=await fixture.generate();assert.equal(result.success,true,`${role}: ${result.error}`);
    }
  });
  await context.test("failed evidence prevents PDF upload and report history",async()=>{
    reset();state.errors.scrap_records={message:"scrap unavailable"};const result=await fixture.generate();assert.equal(result.success,false);
    assert.equal(state.uploads.length,0);assert.equal(state.history.length,0);
  });
  await context.test("retains the existing PDF-only production template contract",async()=>{
    for(const format of ["csv","excel"]){reset();const result=await fixture.generate(format);assert.equal(result.success,false);assert.match(result.error,/does not support/);assert.equal(state.uploads.length,0);}
  });
  await context.test("shared CSV and spreadsheet serializers preserve the corrected model and unknowns",async()=>{
    reset();const model=await fixture.build(),csv=new TextDecoder().decode(fixture.generators.generateCSV(model).bytes),xls=new TextDecoder().decode(fixture.generators.generateExcel(model).bytes);
    assert.match(csv,/Billet Weight kg,100/);assert.match(csv,/Output Good kg,95/);assert.match(csv,/Scrap kg,5/);assert.match(csv,/Recovery %,95/);
    assert.match(xls,/<td>Billet Weight kg<\/td><td>100<\/td>/);
    state.billets=[];assert.match(new TextDecoder().decode(fixture.generators.generateCSV(await fixture.build()).bytes),/Recovery %,Not Captured/);
  });
});
