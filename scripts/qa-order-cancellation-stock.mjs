import assert from "node:assert/strict";
import {createServer} from "node:http";
import {mkdirSync,readFileSync,readdirSync,writeFileSync} from "node:fs";
import {extname,resolve,sep} from "node:path";
import {chromium} from "@playwright/test";
import {createOrderCancellationStockFixture,cancellationIds as f} from "./lib/order-cancellation-stock-fixture.mjs";
import {createDispatchReservationRenderFixture} from "./lib/dispatch-reservation-render-fixture.mjs";

const output=resolve(process.argv[2]??"test-results/order-cancellation-stock");
const staticRoot=resolve(".next/static");
const cssFiles=readdirSync(resolve(staticRoot,"chunks")).filter(name=>name.endsWith(".css"));
const styles=cssFiles.map(name=>`<link rel="stylesheet" href="/_next/static/chunks/${name}">`).join("");
const fontClasses=[...new Set(cssFiles.flatMap(name=>[...readFileSync(resolve(staticRoot,"chunks",name),"utf8")
  .matchAll(/\.([\w-]+)\s*\{[^{}]*--font-jakarta\s*:/g)].map(match=>match[1])))].join(" ");
assert.ok(fontClasses,"Build the application before running this fixture");
const db=await createOrderCancellationStockFixture();
await db.exec(`set test.actor='${f.actor}';set role authenticated;`);
const fixture=createDispatchReservationRenderFixture();
const checks=[];
const server=createServer(async(request,response)=>{
  try{
    const url=new URL(request.url,"http://127.0.0.1");
    if(url.pathname.startsWith("/_next/static/")){
      const target=resolve(staticRoot,decodeURIComponent(url.pathname.slice("/_next/static/".length)));
      if(!target.startsWith(staticRoot+sep)){response.writeHead(404).end();return;}
      response.writeHead(200,{"Content-Type":extname(target)===".css"?"text/css":"application/octet-stream"}).end(readFileSync(target));return;
    }
    fixture.reset();fixture.state.role="owner";fixture.state.dispatchId=f.dispatch;
    fixture.state.rpcOverride=async(name,args)=>{
      assert.equal(name,"get_dispatch_reservation_ledger_page");
      return {data:(await db.query("select public.get_dispatch_reservation_ledger_page($1,$2) data",[args.p_dispatch_id,args.p_page])).rows[0].data,error:null};
    };
    const html=await fixture.render();assert.equal(fixture.state.calls.length,1);assert.deepEqual(fixture.state.tables,[]);
    response.writeHead(200,{"Content-Type":"text/html; charset=utf-8"}).end(`<!doctype html><html lang="en" class="${fontClasses}"><head>
      <meta name="viewport" content="width=device-width, initial-scale=1">${styles}</head><body>
      <main style="max-width:1280px;margin:0 auto;padding:16px">${html}</main></body></html>`);
  }catch(error){response.writeHead(500).end(`Local fixture failed: ${error.message}`);}
});

let browser;
async function physical(){
  // Observation uses the fixture owner; the actual cancellation/read calls use authenticated.
  await db.exec("reset role;");
  try{return {batch:(await db.query("select total_weight_kg,length_m,quantity_pieces,status from profile_stock_batches where id=$1",[f.batch])).rows[0],
    fulfillment:(await db.query("select * from order_dealer_stock_fulfillments where order_id=$1",[f.order])).rows,
    movements:(await db.query("select * from inventory_transactions where order_id=$1 order by id",[f.order])).rows,
    consumption:(await db.query("select * from profile_stock_consumptions order by id")).rows};}
  finally{await db.exec("set role authenticated;");}
}
try{
  await new Promise(ready=>server.listen(0,"127.0.0.1",ready));const base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true});const context=await browser.newContext();
  await context.route("**/*",route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  const page=await context.newPage();const errors=[];page.on("pageerror",error=>errors.push(error.message));
  mkdirSync(output,{recursive:true});const before=await physical();
  const viewports=[["desktop",1440,1000],["tablet",820,1180],["mobile",390,844],["compact-mobile",320,720]];
  for(const phase of ["before","after"]){
    if(phase==="after"){
      // No cancellation UI is substituted: this is an authenticated local SQL control.
      await db.query("update orders set current_stage='cancelled' where id=$1",[f.order]);
      assert.deepEqual(await physical(),before);
    }
    for(const [label,width,height] of viewports){
      await page.setViewportSize({width,height});await page.goto(`${base}/dispatches/${f.dispatch}?phase=${phase}`,{waitUntil:"networkidle"});
      await page.getByRole("heading",{name:"Order reservation ledger",exact:true}).waitFor();await page.evaluate(()=>document.fonts.ready);
      assert.match(await page.evaluate(()=>getComputedStyle(document.body).fontFamily),/Plus Jakarta Sans/);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${phase}/${label}: document overflow`);
      assert.equal(await page.locator("[data-reservation-id]").count(),1);
      const metrics=page.locator("#stock-reservations .grid > div");
      assert.match(await metrics.nth(0).innerText(),phase==="before"?/20\.000 kg/:/0\.000 kg/);
      assert.match(await metrics.nth(1).innerText(),/10\.000 kg/);
      assert.match(await metrics.nth(2).innerText(),phase==="before"?/0\.000 kg/:/20\.000 kg/);
      const row=page.locator(`[data-reservation-id="${f.reservation}"]`);
      assert.match(await row.innerText(),phase==="before"?/ACTIVE/:/CANCELLED/);
      assert.match(await row.locator("td").nth(phase==="before"?4:5).innerText(),/20\.000 kg\s+2 pieces\s+10\.000 m/);
      await page.screenshot({path:resolve(output,`${label}-${phase}.png`),fullPage:true});
      checks.push(`${label} ${phase}: actual SQL-backed panel, exact kg/metres/pieces and bounded layout`);
    }
  }
  await db.query("update orders set current_stage='cancelled' where id=$1",[f.order]);assert.deepEqual(await physical(),before);
  await db.exec("reset role;");
  const audits=(await db.query("select actor_id,metadata_json from audit_logs where entity_id=$1 and action='order_cancelled_hold_release'",[f.order])).rows;
  assert.equal(audits.length,1);assert.equal(audits[0].actor_id,f.actor);assert.equal(audits[0].metadata_json.released_weight_kg,20);
  const other=(await db.query("select status,reserved_weight_kg from profile_stock_reservations where id=$1",[f.otherReservation])).rows[0];
  assert.deepEqual(other,{status:"active",reserved_weight_kg:"20.000"});assert.deepEqual(errors,[]);
  const result={proof:"Actual dispatch reservation panel and read RPC with extracted candidate SQL/ACL/trigger objects in disposable PGlite; built CSS/fonts; synthetic identity; loopback only",
    boundary:"Cancellation is a local authenticated SQL control. This does not implement or prove an operator cancellation UI, a physical-return receipt, hosted Supabase or independent-session races.",
    physicalBeforeAndAfter:before.batch,audits:audits.length,unrelatedHold:other,checks,screenshots:8,pageErrors:errors};
  writeFileSync(resolve(output,"results.json"),JSON.stringify(result,null,2)+"\n");console.log(JSON.stringify(result,null,2));
}finally{
  if(browser)await browser.close();await new Promise(done=>server.close(done));await db.close();
}
