import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

let server, browser, base;
test.before(async () => {
  const bundle = await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {useOfflineQueue} from './components/modules/offline/offline-queue';
    import {bundleTransport,useOfflineQueueCore,OfflineQueuePanel} from './components/modules/offline/offline-core';
    import {newEntry,putEntry,listEntries,ownerKey} from './lib/offline/queue';
    const owner=ownerKey('company','employee');
    window.online=true;window.apSends=[];window.bundleSends=[];
    const bundles=bundleTransport(async payload=>{
      if(!window.online)throw Error('offline');
      window.bundleSends.push(payload);return {success:true,data:{id:payload.id}};
    });
    function Panel({queue}){window.activeQueue=queue;return <OfflineQueuePanel queue={queue}/>}
    function Ap(){return <Panel queue={useOfflineQueue('company','employee')}/>}
    function Bundles(){return <Panel queue={useOfflineQueueCore('company','employee',bundles)}/>}
    const root=createRoot(document.getElementById('app'));
    window.mount=kind=>root.render(kind==='ap'?<Ap/>:<Bundles/>);
    window.remaining=()=>listEntries(owner);
    window.seed=async()=>{
      const entries=['bundle','ap'].map((kind,n)=>{
        const requestId=crypto.randomUUID();
        return newEntry({owner,kind,requestId,rpc:kind==='bundle'?'physical_bundle_command':'ap_press',command:kind==='bundle'?'bundle.record':'push',
          payload:{id:requestId,session_id:'session',job_id:'job'},label:kind,now:new Date('2026-11-17T08:0'+n+':00Z')});
      });
      for(const entry of entries)await putEntry(entry);return entries;
    };
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"test"' },
    plugins: [{ name: "offline-gateway", setup(api) {
      api.onResolve({ filter: /^@\/lib\/actions\/autopilot$/ }, () => ({ path: "gateway", namespace: "boundary" }));
      api.onLoad({ filter: /.*/, namespace: "boundary" }, () => ({ contents: `export async function autopilotAction(rpc,command,payload){
        if(!window.online)throw Error('offline');
        if(command==='resolve')return {success:true,data:{}};
        window.apSends.push(payload);
        if(payload.rpc==='physical_bundle_command')return {success:false,error:'Unsupported Autopilot command'};
        return {success:true,data:{state:'applied',result:{request_id:payload.request_id}}};
      }` }));
    } }] });
  server = createServer((request, response) => {
    response.setHeader("content-type", request.url === "/bundle.js" ? "text/javascript" : "text/html");
    response.end(request.url === "/bundle.js" ? bundle.outputFiles[0].text : '<!doctype html><html><body><div id="app"></div><script src="/bundle.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});
test.after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); });

for (const first of ["ap", "bundle"]) {
  test(`opening the ${first} screen flushes only its own IndexedDB entries and the other screen later retries the original ID`, async () => {
    const context = await browser.newContext();
    try {
      const page = await context.newPage(); const errors = []; page.on("pageerror", error => errors.push(error.message));
      await page.goto(base); const initial = await page.evaluate(() => window.seed());
      await page.evaluate(kind => window.mount(kind), first);
      await expect.poll(() => page.evaluate(async () => (await window.remaining()).length)).toBe(1);
      const other = first === "ap" ? "bundle" : "ap";
      assert.deepEqual(await page.evaluate(() => window.remaining()), initial.filter(entry => entry.kind === other));
      // A full page load proves the untouched entry survived in IndexedDB, beyond React's screen state.
      await page.reload(); await page.evaluate(kind => window.mount(kind), other);
      await expect.poll(() => page.evaluate(async () => (await window.remaining()).length)).toBe(0);
      const sent = await page.evaluate(kind => kind === "ap" ? window.apSends : window.bundleSends, other);
      assert.equal(sent.length, 1);
      assert.equal(other === "ap" ? sent[0].request_id : sent[0].id, initial.find(entry => entry.kind === other).request_id);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
}

test("switching offline screens preserves both pending entries and reconnecting sends only the active transport", async () => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage(); await page.goto(base);
    const initial = await page.evaluate(async () => { window.online = false; return window.seed(); });
    await page.evaluate(() => window.mount("ap"));
    await expect.poll(() => page.evaluate(async () => (await window.remaining()).find(entry => entry.kind === "ap").attempts)).toBe(1);
    assert.deepEqual((await page.evaluate(() => window.remaining())).find(entry => entry.kind === "bundle"), initial[0]);
    await page.evaluate(() => window.mount("bundle"));
    await expect.poll(() => page.evaluate(async () => (await window.remaining()).find(entry => entry.kind === "bundle").attempts)).toBe(1);
    await page.evaluate(() => { window.online = true; window.dispatchEvent(new Event("online")); });
    await expect.poll(() => page.evaluate(async () => (await window.remaining()).length)).toBe(1);
    const left = await page.evaluate(() => window.remaining());
    assert.equal(left[0].kind, "ap"); assert.equal(left[0].state, "pending"); assert.equal(left[0].attempts, 1);
    await page.evaluate(() => window.mount("ap"));
    await expect.poll(() => page.evaluate(async () => (await window.remaining()).length)).toBe(0);
    assert.deepEqual(await page.evaluate(() => [window.apSends.length, window.bundleSends.length]), [1, 1]);
  } finally { await context.close(); }
});
