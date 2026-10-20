import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve,sep,extname} from 'node:path';
import {build} from 'esbuild';
import {chromium} from '@playwright/test';
import {createFinishingBoardPageFixture,createFinishingActionFixture} from './finishing-board-page-fixture.mjs';

export async function createFinishingWorkloadBrowserFixture(sql,{styled=false,development=false}={}){
  const reader=createFinishingBoardPageFixture({island:true}),writer=createFinishingActionFixture(sql),control={unavailable:false};
  reader.state.rpcOverride=async(name,args)=>{assert.equal(name,'get_finishing_workload');if(control.unavailable)return {data:null,error:{message:'Synthetic reader unavailable'}};
    await sql.db.query("select set_config('test.role',$1,false)",[reader.state.role]);
    try{const data=await sql.workload({order:args.p_order_id,production:args.p_production_job_id,record:args.p_finishing_job_id,status:args.p_status,search:args.p_search,sort:args.p_sort,direction:args.p_direction,page:args.p_page});return {data:JSON.parse(JSON.stringify(data)),error:null};
    }catch(error){return {data:null,error:{message:error.message}};}
  };
  const staticRoot=resolve('.next/static');let styles='',fonts='';
  if(styled){const files=readdirSync(resolve(staticRoot,'chunks')).filter(name=>name.endsWith('.css'));
    styles=files.map(name=>`<link rel="stylesheet" href="/_next/static/chunks/${name}">`).join('');
    fonts=[...new Set(files.flatMap(name=>[...readFileSync(resolve(staticRoot,'chunks',name),'utf8').matchAll(/\.([\w-]+)\s*\{[^{}]*--font-jakarta\s*:/g)].map(match=>match[1])))].join(' ');assert.ok(fonts);}
  const bundle=await build({stdin:{sourcefile:'finishing-workload-browser.tsx',loader:'tsx',resolveDir:process.cwd(),contents:`
    import React,{useEffect}from'react';import{hydrateRoot,createRoot}from'react-dom/client';import{Toaster}from'sonner';import{FinishingWorkflowBoard}from'./components/modules/finishing-workflow-board';
    const host=document.getElementById('finishing-workflow-island');window.__finishingActions=[];
    function ReadyBoard(){useEffect(()=>{window.__finishingReady=true},[]);return <FinishingWorkflowBoard {...window.__finishingProps}/>}
    if(host)hydrateRoot(host,<ReadyBoard/>);else window.__finishingReady=true;
    createRoot(document.getElementById('toasts')).render(<Toaster/>);
  `},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':development?'"development"':'"production"'},plugins:[{name:'loopback-finishing-bridge',setup(plugin){
    plugin.onResolve({filter:/^next\/navigation$/},()=>({path:'navigation',namespace:'fixture'}));plugin.onResolve({filter:/^@\/lib\/actions\/finishing$/},()=>({path:'actions',namespace:'fixture'}));
    plugin.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'js',contents:args.path==='navigation'?`export const useRouter=()=>({refresh(){location.reload()}});`:`
      async function call(kind,input){window.__finishingActions.push({kind,input});const response=await fetch('/fixture-action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind,input})});return response.json()}
      export const transitionFinishingJobAction=input=>call('transition',input),retryRejectedFinishingJobAction=input=>call('retry',input);`}));
  }}]});
  const server=createServer(async(request,response)=>{try{
    const url=new URL(request.url,'http://127.0.0.1');
    if(url.pathname==='/fixture.js'){response.writeHead(200,{'Content-Type':'application/javascript'}).end(bundle.outputFiles[0].contents);return;}
    if(styled&&url.pathname.startsWith('/_next/static/')){const target=resolve(staticRoot,decodeURIComponent(url.pathname.slice('/_next/static/'.length)));if(!target.startsWith(staticRoot+sep)){response.writeHead(404).end();return;}
      response.writeHead(200,{'Content-Type':extname(target)==='.css'?'text/css':'application/octet-stream'}).end(readFileSync(target));return;}
    if(url.pathname==='/fixture-action'&&request.method==='POST'){
      let body='';for await(const part of request){body+=part;if(body.length>65536)throw new Error('Fixture request too large');}
      const {kind,input}=JSON.parse(body);writer.state.role=reader.state.role;const result=kind==='retry'?await writer.actions.retryRejectedFinishingJobAction(input):await writer.actions.transitionFinishingJobAction(input);
      response.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(result));return;
    }
    reader.state.boardProps=null;const params=Object.fromEntries(url.searchParams),tail=url.pathname.split('/').filter(Boolean).at(-1);
    const markup=tail==='database'?await reader.database(params):tail&&tail!=='finishing'?await reader.receipt(tail):await reader.render(params);
    const props=JSON.stringify(reader.state.boardProps??{}).replace(/</g,'\\u003c');
    response.writeHead(200,{'Content-Type':'text/html'}).end(`<!doctype html><html lang="en" class="${fonts}"><head><meta name="viewport" content="width=device-width,initial-scale=1">${styles}</head><body><main style="max-width:1440px;margin:auto;padding:16px">${markup}</main><div id="toasts"></div><script>window.__finishingProps=${props}</script><script src="/fixture.js"></script></body></html>`);
  }catch(error){if(response.headersSent)response.destroy();else response.writeHead(500).end(error.message);}});
  await new Promise(done=>server.listen(0,'127.0.0.1',done));let browser;
  try{browser=await chromium.launch({headless:true});const context=await browser.newContext(),base=`http://127.0.0.1:${server.address().port}`;
    await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());const page=await context.newPage(),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
    return {page,base,errors,reader,writer,control,
      async open(path='/production/finishing'){await page.goto(base+path);await page.waitForFunction(()=>window.__finishingReady);},
      async close(){await browser.close();server.closeAllConnections();await new Promise(done=>server.close(done));}};
  }catch(error){if(browser)await browser.close();server.closeAllConnections();await new Promise(done=>server.close(done));throw error;}
}
