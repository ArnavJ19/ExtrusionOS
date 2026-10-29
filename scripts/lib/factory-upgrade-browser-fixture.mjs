import {createServer} from 'node:http';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve,sep,extname} from 'node:path';
import {build} from 'esbuild';
import {chromium} from '@playwright/test';
export async function createFactoryBrowserFixture({component='TransactionCommunication',props={},results={},styled=false}={}){
  const components={TransactionCommunication:'components/modules/financials/transaction-communication',Workstation:'components/modules/production/workstation',StockProduction:'components/modules/orders/stock-production',CuttingWorkspace:'components/modules/production/cutting-workspace',MachineUsage:'components/modules/production/machine-usage'};
  const boundaries={'transaction-communication':['invoiceCommunicationAction'],workstation:['workstationAction','switchWorkstationOperatorAction'],'stock-production':['stockProductionAction'],'cutting-workspace':['cuttingWorkspaceAction'],'machine-usage':['machineUsageAction']};
  const staticRoot=resolve(process.env.NEXT_DIST_DIR||'.next','static');let styles='',fontClasses='';
  if(styled){const files=['chunks','css'].flatMap(dir=>{try{return readdirSync(resolve(staticRoot,dir)).filter(n=>n.endsWith('.css')).map(n=>`${dir}/${n}`);}catch{return [];}});styles=files.map(n=>`<link rel="stylesheet" href="/_next/static/${n}">`).join('');fontClasses=[...new Set(files.flatMap(n=>[...readFileSync(resolve(staticRoot,n),'utf8').matchAll(/\.([\w-]+)\s*\{[^{}]*--font-jakarta\s*:/g)].map(m=>m[1])))].join(' ');}
  const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {${component}} from './${components[component]}';window.__factory={calls:[],results:${JSON.stringify(results)},responses:{},navigation:[]};createRoot(document.getElementById('app')).render(<${component} {...${JSON.stringify(props)}}/>);`,sourcefile:'factory-upgrade-fixture.tsx',resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'factory-boundaries',setup(plugin){
    plugin.onResolve({filter:/^@\/lib\/actions\/(transaction-communication|workstation|stock-production|cutting-workspace|machine-usage)$/},args=>({path:args.path.split('/').at(-1),namespace:'actions'}));
    plugin.onLoad({filter:/.*/,namespace:'actions'},args=>({loader:'js',contents:boundaries[args.path].map(name=>`export async function ${name}(input){window.__factory.calls.push({name:${JSON.stringify(name)},input});const configured=window.__factory.results[${JSON.stringify(name)}];const next=window.__factory.responses[${JSON.stringify(name)}]?.shift()??configured?.[input?.command]??configured;if(next?.throw)throw new Error('Fixture transport failure');return next??{success:false,error:'Fixture result unavailable'};}`).join('\n')}));
    plugin.onResolve({filter:/^next\/(link|navigation)$/},args=>({path:args.path,namespace:'next'}));
    plugin.onLoad({filter:/.*/,namespace:'next'},args=>({loader:'js',resolveDir:process.cwd(),contents:args.path==='next/link'?`import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children)}`:`export function useRouter(){return {push(path){window.__factory.navigation.push(path)},replace(path){window.__factory.navigation.push(path)},refresh(){}}}`}));
  }}]});
  const server=createServer((request,response)=>{try{
    if(request.url==='/fixture.js'){response.writeHead(200,{'Content-Type':'application/javascript'}).end(bundle.outputFiles[0].contents);return;}
    if(styled&&request.url.startsWith('/_next/static/')){const path=resolve(staticRoot,decodeURIComponent(request.url.slice('/_next/static/'.length)));if(!path.startsWith(staticRoot+sep)){response.writeHead(404).end();return;}response.writeHead(200,{'Content-Type':extname(path)==='.css'?'text/css':'application/octet-stream'}).end(readFileSync(path));return;}
    response.writeHead(200,{'Content-Type':'text/html'}).end(`<!doctype html><html lang="en" class="${fontClasses}"><head><meta name="viewport" content="width=device-width,initial-scale=1">${styles}</head><body><main style="max-width:1280px;margin:auto;padding:16px"><div id="app"></div></main><script src="/fixture.js"></script></body></html>`);
  }catch(e){response.writeHead(500).end(e.message);}});
  await new Promise(done=>server.listen(0,'127.0.0.1',done));let browser;
  try{browser=await chromium.launch({headless:true});const context=await browser.newContext({permissions:['clipboard-read','clipboard-write']});const base=`http://127.0.0.1:${server.address().port}`;
    await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    return {page,errors,async reset(){errors.length=0;await page.goto(base);await page.locator('#app > *').first().waitFor();},async close(){await browser.close();server.closeAllConnections();await new Promise(done=>server.close(done));}};
  }catch(error){if(browser)await browser.close();server.closeAllConnections();await new Promise(done=>server.close(done));throw error;}
}
