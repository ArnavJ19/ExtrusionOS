import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { chromium } from "@playwright/test";
import { createDispatchReservationRenderFixture, reservationFixtureRow, reservationFixtureDispatch as dispatch } from "./lib/dispatch-reservation-render-fixture.mjs";

const output=resolve(process.argv[2]??"artifacts/qa/dispatch-reservation-ledger");
const staticRoot=resolve(".next/static");
const cssFiles=readdirSync(resolve(staticRoot,"chunks")).filter(name=>name.endsWith(".css"));
const styles=cssFiles.map(name=>`<link rel="stylesheet" href="/_next/static/chunks/${name}">`).join("");
const fontClasses=[...new Set(cssFiles.flatMap(name=>[...readFileSync(resolve(staticRoot,"chunks",name),"utf8")
  .matchAll(/\.([\w-]+)\s*\{[^{}]*--font-jakarta\s*:/g)].map(match=>match[1])))].join(" ");
assert.ok(fontClasses,"Build the application before running this fixture");
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
    const mode=url.searchParams.get("mode")??"normal";
    fixture.reset();
    if(mode==="released")fixture.state.rows=[reservationFixtureRow(10,"released"),reservationFixtureRow(11,"cancelled"),reservationFixtureRow(12,"consumed")];
    if(mode==="unknown")fixture.state.rows=[{...reservationFixtureRow(),reserved_length_m:null,consumed_length_m:null,open_length_m:null,
      reserved_pieces:null,consumed_pieces:null,open_pieces:null}];
    if(mode==="empty")fixture.state.rows=[];
    if(mode==="unlinked")fixture.state.result={data:{dispatch_id:dispatch,order_id:null,order_number:null,ledger:null},error:null};
    if(mode==="unavailable")fixture.state.result={data:null,error:{message:"Private synthetic database failure"}};
    if(mode==="large")fixture.state.rows=[{...reservationFixtureRow(),reserved_weight_kg:99999999999.999,consumed_weight_kg:10000,open_weight_kg:99999989999.999}];
    const html=await fixture.render({reservationPage:url.searchParams.get("reservationPage")??undefined});
    assert.equal(fixture.state.calls.length,1);assert.deepEqual(fixture.state.tables,[]);
    response.writeHead(200,{"Content-Type":"text/html; charset=utf-8"}).end(`<!doctype html><html lang="en" class="${fontClasses}"><head>
      <meta name="viewport" content="width=device-width, initial-scale=1">${styles}</head><body>
      <main style="max-width:1280px;margin:0 auto;padding:16px">${html}</main></body></html>`);
  }catch(error){response.writeHead(500).end(`Local fixture failed: ${error.message}`);}
});

let browser;
try{
  await new Promise(ready=>server.listen(0,"127.0.0.1",ready));
  const base=`http://127.0.0.1:${server.address().port}`;
  const path=`/dispatches/${dispatch}`;
  browser=await chromium.launch({headless:true});const context=await browser.newContext();
  await context.route("**/*",route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  const page=await context.newPage();const errors=[];page.on("pageerror",error=>errors.push(error.message));
  mkdirSync(output,{recursive:true});
  async function bounded(label){
    await page.evaluate(()=>document.fonts.ready);
    assert.match(await page.evaluate(()=>getComputedStyle(document.body).fontFamily),/Plus Jakarta Sans/);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${label}: viewport overflow`);
    assert.ok(await page.evaluate(()=>[...document.querySelectorAll("a")].every(element=>{
      const rect=element.getBoundingClientRect();return rect.width===0||(rect.left>=0&&rect.right<=innerWidth+1);
    })),`${label}: overflowing navigation`);
  }
  for(const [label,width,height] of [["desktop",1440,1000],["tablet",820,1180],["mobile",390,844],["compact-mobile",320,720]]){
    await page.setViewportSize({width,height});await page.goto(base+path,{waitUntil:"networkidle"});
    await page.getByRole("heading",{name:"Order reservation ledger",exact:true}).waitFor();
    assert.equal(await page.locator("[data-reservation-id]").count(),10);
    assert.ok(await page.getByText("1,399.000 kg",{exact:true}).isVisible());
    assert.ok(await page.getByText("4,801.000 kg",{exact:true}).isVisible());
    assert.ok(await page.getByText("1,800.000 kg",{exact:true}).isVisible());
    await bounded(label);
    if(width<1100)assert.ok(await page.locator("table").evaluate(table=>table.parentElement.scrollWidth>table.parentElement.clientWidth));
    await page.screenshot({path:resolve(output,`${label}-complete.png`),fullPage:true});
    await page.getByRole("link",{name:"Next",exact:true}).click();
    await page.getByText("Page 2 of 61",{exact:true}).waitFor();
    assert.equal(await page.locator("[data-reservation-id]").count(),10);
    assert.equal(await page.locator("[data-reservation-id]").first().getAttribute("data-reservation-id"),"00000000-0000-4000-8000-000000001010");
    await page.getByRole("link",{name:"Previous",exact:true}).click();
    await page.getByText("Page 1 of 61",{exact:true}).waitFor();
    checks.push(`${label}: complete source-order totals, ten rows, bounded layout and working next/previous navigation`);
  }
  await page.setViewportSize({width:390,height:844});
  await page.goto(base+path+"?reservationPage=61",{waitUntil:"networkidle"});
  await page.getByText("Page 61 of 61",{exact:true}).waitFor();assert.equal(await page.locator("[data-reservation-id]").count(),1);
  assert.equal(await page.getByRole("link",{name:"Next",exact:true}).count(),0);
  await bounded("last page");await page.screenshot({path:resolve(output,"mobile-last-page.png"),fullPage:true});
  checks.push("Last page reaches reservation 601 with invariant totals and no phantom next page");
  for(const mode of ["released","unknown","empty","unlinked","unavailable","large"]){
    await page.goto(base+path+"?mode="+mode,{waitUntil:"networkidle"});await bounded(mode);
    const text=await page.locator("main").innerText();
    if(mode==="released"){
      assert.match(text,/0 active reservations/);assert.match(text,/Released/i);assert.match(text,/Cancelled/i);assert.match(text,/12\.000 kg/);
    }
    if(mode==="unknown"){assert.match(text,/Metres not captured/);assert.match(text,/Pieces not captured/);}
    if(mode==="empty"){assert.match(text,/No reservations are recorded/);assert.doesNotMatch(text,/unavailable/);}
    if(mode==="unlinked"){assert.match(text,/No source order is linked/);assert.doesNotMatch(text,/Open holds/);}
    if(mode==="unavailable"){
      assert.equal(await page.getByRole("alert").count(),1);assert.match(text,/could not be verified/);
      assert.doesNotMatch(text,/Open holds|No reservations|Private synthetic/);
      assert.equal(await page.getByRole("link",{name:"Retry loading reservations",exact:true}).getAttribute("href"),path+"?reservationPage=1#stock-reservations");
    }
    if(mode==="large")assert.match(text,/99,99,99,89,999\.999 kg/);
    await page.screenshot({path:resolve(output,`mobile-${mode}.png`),fullPage:true});
    checks.push(`Mobile ${mode}: explicit state and bounded layout`);
  }
  assert.deepEqual(errors,[]);
  const result={proof:"Actual dispatch route and reservation panel; synthetic identity and RPC transport; built CSS/fonts; loopback only",
    boundary:"This is not a signed-in Supabase session, migration replay, full dispatch page journey or physical return test",checks,screenshots:11,pageErrors:errors};
  writeFileSync(resolve(output,"results.json"),JSON.stringify(result,null,2)+"\n");
  console.log(JSON.stringify(result,null,2));
}finally{
  if(browser)await browser.close();
  await new Promise(done=>server.close(done));
}
