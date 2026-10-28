import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import loadConfig from 'tailwindcss/loadConfig.js';
import {createGuidedFixture,eids} from './guided-sop-fixture.mjs';

export async function createSopBrowserFixture() {
 const f=await createGuidedFixture();
 await f.db.exec(readFileSync('supabase/migrations/20261028020000_sop_recovery_and_observation.sql','utf8'));
 await f.db.exec(`create table customers(id uuid primary key,company_id uuid);
   alter table orders add column customer_id uuid;alter table orders add column deleted_at timestamptz;
   alter table production_jobs add column order_id uuid;alter table quality_inspections add column finishing_job_id uuid;
   create table finishing_jobs(id uuid primary key,company_id uuid,order_id uuid);
   create table packaging_jobs(id uuid primary key,company_id uuid,order_id uuid,status text);
   create table customer_compliance_requirements(id uuid primary key default gen_random_uuid(),company_id uuid,customer_id uuid,certificate_type text,description text,is_mandatory boolean default true,is_active boolean default true,updated_at timestamptz default now());`);
 await f.db.exec(readFileSync('supabase/migrations/20261028030000_customer_step_requirements.sql','utf8'));
 let task,job,version,order,customer;
 const actors={operator:eids.operator,operator2:eids.operator2,quality:eids.sopBackup,owner:eids.owner,supervisor:eids.sopOwner};
 const roles={operator:'production',operator2:'production',quality:'quality',owner:'owner',supervisor:'production_manager'};
 const assurance=async(n,p,a=eids.owner)=>(await f.asUser('select sop_assurance_command($1,$2) data',[n,p],a))[0].data;
 const requirements=async(n,p,a=eids.owner)=>(await f.asUser('select customer_requirement_command($1,$2) data',[n,p],a))[0].data;
 async function reset(){
   await f.db.exec('truncate sop_observed_trials,sop_recovery_notes,sop_continuity_policies,order_requirement_acknowledgements,customer_compliance_requirements,customers,finishing_jobs,packaging_jobs cascade');await f.reset();
   version=await f.plan();({task,job}=await f.start());
   customer=f.nextId();order=f.nextId();
   await f.db.query('insert into customers values($1,$2)',[customer,eids.company]);
   await f.db.query("insert into orders(id,company_id,customer_id,current_stage) values($1,$2,$3,'packing')",[order,eids.company,customer]);
   await f.db.query('update production_jobs set order_id=$2 where id=$1',[job,order]);
   await requirements('requirement.save',{id:f.nextId(),customer_id:customer,title:'Batch hardness certificate',description:'Review the batch certificate and its inspection reference before quality release',stages:['quality','dispatch'],is_mandatory:true,is_active:true});
   await assurance('policy.save',{task_kind:'type:die_change',permitted_work:'Isolate press and record numbered measurements on paper',prohibited_work:'No stock issues, quality releases or dispatches during outage',reconcile_role:'quality'});
 }
 const aliases={
   'next/navigation':`export function useRouter(){return {refresh(){window.mount()},push(){window.mount()}}}`,
   'next/link':`import React from 'react';export default function Link({children,...props}){return <a {...props}>{children}</a>}`,
   '@/lib/actions/guided-sop':`async function action(kind,payload){const q=new URLSearchParams(location.search);const r=await fetch('/command?role='+q.get('role'),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind,payload})});return r.json()}export const guidedSopAction=p=>action('guided',p);export const sopAssuranceAction=p=>action('assurance',p);`,
   '@/lib/actions/procedure-effectiveness':`export async function procedureEffectivenessAction(payload){return (await fetch('/command?role=operator',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:'effectiveness',payload})})).json()}`
   , '@/lib/actions/customer-step-requirements':`export async function customerRequirementAction(payload){return (await fetch('/command?role='+new URLSearchParams(location.search).get('role'),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:'requirements',payload})})).json()}`
   , '@/lib/actions/task-blueprints':`export async function taskBlueprintAction(payload){return (await fetch('/command?role=owner',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:'blueprints',payload})})).json()}`
 };
 const bundle=await build({stdin:{resolveDir:process.cwd(),sourcefile:'sop-browser.tsx',loader:'tsx',contents:`
 import React from 'react';import {createRoot} from 'react-dom/client';
 import {GuidedExecution,ExecutionPlanEditor} from './components/modules/tasks/guided-sop';
 import {ContinuityPolicy,RecoveryRecord,RecoveryDecision,ObservedTrialStart,ObservedTrialReview} from './components/modules/tasks/sop-assurance';
 import {OutcomeCard,FlagStep,ImprovementProposal} from './components/modules/tasks/procedure-effectiveness';
 import {RequirementAcknowledge} from './components/modules/orders/customer-requirements';
 import {BlueprintForm} from './components/modules/tasks/task-blueprints';
 import {runViewSchema,planLoadSchema,recoveryListSchema,trialsListSchema} from './lib/workflow/guided-sop';
 const root=createRoot(document.getElementById('app'));
 window.mount=async()=>{const q=new URLSearchParams(location.search);const data=await(await fetch('/state?'+q)).json();const {task,userId,role,instructions,screen}=data;const view=runViewSchema.parse(data.view);const trials=trialsListSchema.parse(data.trials);const notes=recoveryListSchema.parse(data.notes);
 root.render(<main className='mx-auto max-w-4xl space-y-4 p-4'><h1 className='text-2xl font-bold'>Die change / {screen}</h1>{screen==='blueprint'?<BlueprintForm blueprint={null}/>:screen==='requirements'?data.customerRequirements.rows.map(item=><RequirementAcknowledge key={item.id+Boolean(item.acknowledgement)} orderId={data.order} stage='quality' item={item}/>):screen==='plan'?<ExecutionPlanEditor versionId={data.version} data={planLoadSchema.parse(data.plan)} userId={userId}/>:screen==='recovery'?<><ContinuityPolicy policy={data.policy} taskKind='type:die_change' canManage={role==='owner'}/>{role==='production'?<RecoveryRecord taskId={task}/>:null}{notes.rows.map(n=><RecoveryDecision key={n.id+n.status} item={n} canDecide={userId!==n.recorded_by&&role==='quality'}/>)}</>:screen==='trial'?<><ObservedTrialStart taskId={task}/>{trials.rows.map(t=><ObservedTrialReview key={t.id+t.revision} trial={t} instructions={instructions} userId={userId} canReview={t.can_review}/>)}</>:screen==='effectiveness'?<><OutcomeCard outcome={data.outcome}/><FlagStep taskId={task} steps={instructions}/><ImprovementProposal procedureId={data.procedure} flags={[]}/></>:<GuidedExecution key={view.run?.revision} taskId={task} view={view} instructions={instructions} userId={userId} role={role}/>}</main>)};window.mount();
 `},bundle:true,write:false,jsx:'automatic',format:'iife',platform:'browser',plugins:[{name:'sop-fixture',setup(api){api.onResolve({filter:/^(next\/(navigation|link)|@\/lib\/actions\/(guided-sop|procedure-effectiveness|customer-step-requirements|task-blueprints))$/},({path})=>({path,namespace:'fixture'}));api.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:aliases[path],loader:'tsx',resolveDir:process.cwd()}));}}]});
 const config=loadConfig(process.cwd()+'/tailwind.config.ts');const css=await postcss([tailwindcss({...config,content:[{raw:readFileSync('components/modules/tasks/guided-sop.tsx','utf8')+readFileSync('components/modules/tasks/sop-assurance.tsx','utf8')+readFileSync('components/modules/tasks/procedure-effectiveness.tsx','utf8')+readFileSync('components/ui/button.tsx','utf8')+readFileSync('components/modules/orders/customer-requirements.tsx','utf8')+readFileSync('components/modules/tasks/task-blueprints.tsx','utf8')+' mx-auto max-w-4xl space-y-4 p-4 text-2xl font-bold',extension:'tsx'}]})]).process(readFileSync('app/globals.css','utf8'),{from:undefined});
 const server=createServer(async(req,res)=>{try{
   const url=new URL(req.url,'http://127.0.0.1');const roleKey=url.searchParams.get('role')||'operator';const actor=actors[roleKey]||eids.operator;
   if(url.pathname==='/bundle.js'){res.setHeader('content-type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
   if(url.pathname==='/font400.woff2'||url.pathname==='/font700.woff2'){res.setHeader('content-type','font/woff2');res.end(readFileSync(`node_modules/@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-${url.pathname==='/font400.woff2'?'400':'700'}-normal.woff2`));return;}
   if(url.pathname==='/style.css'){res.setHeader('content-type','text/css');res.end('@font-face{font-family:FixtureJakarta;src:url(/font400.woff2);font-weight:400}@font-face{font-family:FixtureJakarta;src:url(/font700.woff2);font-weight:700}:root{--font-jakarta:FixtureJakarta;--font-outfit:FixtureJakarta}'+css.css);return;}
   if(url.pathname==='/state'){
     const view=await f.cmd('run.load',{task_id:task},actor);const plan=await f.cmd('plan.load',{version_id:version.id},actor);const policy=(await assurance('policy.load',{task_id:task},actor)).policy;
     const notes=await assurance('recovery.list',{task_id:task},actor),trials=await assurance('trial.list',{task_id:task},actor);
     const outcomes=(await f.asUser("select procedure_effectiveness_command('outcomes',$1) data",[{procedure_id:eids.sop}],actor))[0].data;
     const screen=url.searchParams.get('screen')||'guided';
     const customerRequirements=screen==='requirements'?await requirements('order.list',{order_id:order,stage:'quality'},actor):null;
     res.setHeader('content-type','application/json');res.end(JSON.stringify({task,job,order,customerRequirements,version:version.id,procedure:eids.sop,userId:actor,role:roles[roleKey],view,plan,policy,notes,trials,instructions:plan.instructions,screen,outcome:outcomes.versions[0]}));return;
   }
   if(url.pathname==='/command'){
     let raw='';for await(const chunk of req)raw+=chunk;const {kind,payload}=JSON.parse(raw);const {command,...p}=payload;
     let result;try{const data=kind==='requirements'?await requirements(command,p,actor):kind==='blueprints'?(await f.asUser('select task_blueprint_command($1,$2) data',[command,p],actor))[0].data:kind==='assurance'?await assurance(command,p,actor):kind==='effectiveness'?(await f.asUser('select procedure_effectiveness_command($1,$2) data',[command,p],actor))[0].data:await f.cmd(command,p,actor);result={success:true,data};}catch(e){result={success:false,error:e.message};}
     res.setHeader('content-type','application/json');res.end(JSON.stringify(result));return;
   }
   res.setHeader('content-type','text/html');res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="app"></div><script src="/bundle.js"></script>');
 }catch(e){res.statusCode=500;res.end(e.message);}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {...f,reset,base:`http://127.0.0.1:${server.address().port}`,getTask:()=>task,getJob:()=>job,close:async()=>{await new Promise(resolve=>server.close(resolve));await f.close();}};
}
