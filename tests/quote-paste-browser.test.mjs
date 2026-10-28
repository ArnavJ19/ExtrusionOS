import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

const mocks = {
  "next/link": `export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>;}`,
  "@/lib/supabase/browser": `
    const profiles=[{id:"profile-a",profile_code:"AL-101",profile_name:"Approved window",section_weight_kg_per_m:0.8,drawing_approval_status:"approved",standard_length:6}];
    export function createClient(){return {from(table){const q={table,filters:[],lookup:false,single:false};const chain={
      select(){return this;},eq(key,value){q.filters.push([key,value]);return this;},order(){return this;},limit(){return this;},or(){return this;},
      in(key,values){q.lookup=key==="profile_code";q.codes=values;return this;},maybeSingle(){q.single=true;return this;},
      then(resolve,reject){window.reads.push(q);const data=table==="aluminium_profiles"?profiles:table==="customers"?[{id:"customer-a",customer_name:"Fixture customer",company_name:"Fixture factory"}]:table==="company_settings_authorized"?{default_conversion_charge_per_kg:30,default_packing_charge:0,default_margin_percent:10}:[];
        if(q.lookup && window.deferLookup){return new Promise(done=>window.finishLookup=()=>done({data,error:null})).then(resolve,reject);}
        return Promise.resolve({data,error:null}).then(resolve,reject);}
    };return chain;}};}
  `,
  "@/lib/actions/quotes-orders": `export async function saveQuoteAction(data){window.writes.push(data);return {success:true};} export async function updateQuoteStatusAction(){throw new Error("Unexpected workflow write");}`,
  "@/lib/actions/in-task-customers": `export async function inTaskCustomerAction(request){window.customerActions.push(request);return window.customerAction?window.customerAction(request):{kind:"checked",matches:[],hasMore:false};}`,
  "@/lib/actions/costing-rates": `export async function costingRateAction(){throw new Error("Unexpected costing rate request");}`,
  "@/lib/actions/profile-technical-options": `export async function profileTechnicalAction(){return {success:false,error:"Technical approval is outside this entry fixture"}}`,
  "@/lib/actions/transaction-evidence": `export async function materialSuggestionsAction(){return {success:false,error:"Material suggestions are outside this entry fixture"}}export async function orderTransactionProgressAction(){return {success:false,error:"Progress is outside this entry fixture"}}`,
  "@/lib/actions/repeat-quote": `export async function repeatQuoteAction(){return {success:false,error:"No repeat source in this fixture"}}`,
  "sonner": `export const toast={error(message){window.errors.push(String(message));},success(){}};`,
  "@/components/ui/profile-selector": `export function ProfileSelector({value,profiles,onChange}) {return <select aria-label="Profile" value={value} onChange={event=>onChange(event.target.value)}><option value="">Select profile</option>{profiles.map(p=><option key={p.id} value={p.id}>{p.profile_code}</option>)}</select>;}`,
  "@/components/ui/searchable-select": `export function SearchableSelect({value,options,onChange,placeholder,disabled}) {return <select aria-label={placeholder} value={value} disabled={disabled} onChange={event=>onChange(event.target.value)}><option value="">{placeholder}</option>{options.map(p=><option key={p.value} value={p.value}>{p.label}</option>)}</select>;}`,
};

let browser, page, script;
test.before(async () => {
  const bundle = await build({
    stdin:{resolveDir:process.cwd(),sourcefile:"quote-paste-fixture.tsx",loader:"tsx",contents:`
      import React from "react"; import {createRoot} from "react-dom/client";
      import {QuotesClient} from "./components/modules/quotes-client";
      window.writes=[];window.reads=[];window.errors=[];window.customerActions=[];
      const root=createRoot(document.getElementById("app"));root.render(<QuotesClient context={{companyId:"company-a",userId:"user-a",role:"owner"}} mode="form"/>);
    `},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",
    plugins:[{name:"quote-fixture",setup(b){b.onResolve({filter:/^(?:next\/link|sonner|@\/lib\/supabase\/browser|@\/lib\/actions\/(?:quotes-orders|in-task-customers|repeat-quote|costing-rates|profile-technical-options|transaction-evidence)|@\/components\/ui\/profile-selector|@\/components\/ui\/searchable-select)$/},args=>({path:args.path,namespace:"fixture"}));b.onLoad({filter:/.*/,namespace:"fixture"},args=>({contents:mocks[args.path],loader:"tsx",resolveDir:process.cwd()}));}}]
  });script=bundle.outputFiles[0].text;
  const path=process.env.CHROME_PATH??["C:/Program Files/Google/Chrome/Application/chrome.exe","C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
  browser=await chromium.launch({headless:true,...(path?{executablePath:path}:{})});
});
test.beforeEach(async()=>{page=await browser.newPage();await page.setContent('<main id="app"></main>');await page.addScriptTag({content:script});await page.getByLabel("Paste quote lines from Excel").waitFor();});
test.afterEach(async()=>{await page?.close();});test.after(async()=>{await browser?.close();});

test("mixed paste stays out of draft until corrected, then appends all lines without inherited charges or writes", async()=>{
  const first=page.locator("[data-quote-line]").first();
  await first.getByText("Costing and recovery for item 1",{exact:true}).click();
  await first.getByLabel("Die charge",{exact:true}).fill("999");
  await first.getByLabel("Sales override",{exact:true}).fill("777");
  await page.getByLabel("Paste quote lines from Excel").fill("Profile Code\tQuantity (pcs)\tLength (mm)\tFinish\nAL-101\t100\t6000\tMill finish\nUNKNOWN\t5\t6000\tAnodizing");
  const importButton=page.getByRole("button",{name:"Import 2 lines into draft"});
  await expect(importButton).toBeDisabled();await page.getByRole("button",{name:"Check profile codes"}).click();
  await expect(page.getByText("1 of 2 rows valid",{exact:false})).toBeVisible();
  await expect(page.locator("[data-quote-line]")).toHaveCount(1);
  await page.getByLabel("Row 3 profile code").fill("AL-101");
  await page.getByRole("button",{name:"Check profile codes"}).click();
  await expect(importButton).toBeEnabled();await importButton.click();
  await expect(page.locator("[data-quote-line]")).toHaveCount(3);
  const imported=page.locator("[data-quote-line]").nth(1);
  await expect(imported.getByLabel("Qty pcs",{exact:true})).toHaveValue("100");
  await expect(imported.getByLabel("Length m",{exact:true})).toHaveValue("6");
  await expect(imported.getByLabel("Die charge",{exact:true})).toHaveValue("0");
  await expect(imported.getByLabel("Sales override",{exact:true})).toHaveValue("");
  await expect(imported).toContainText("480.000 kg");
  assert.deepEqual(await page.evaluate(()=>window.writes),[]);
  const lookup=await page.evaluate(()=>window.reads.find(row=>row.lookup));
  assert.deepEqual(lookup.filters,[["company_id","company-a"],["is_active",true]]);
});

test("a response for an older paste cannot authorise a new paste",async()=>{
  await page.evaluate(()=>window.deferLookup=true);
  const area=page.getByLabel("Paste quote lines from Excel");
  await area.fill("Profile Code\tQuantity (pcs)\tLength (m)\nAL-101\t100\t6");
  await page.getByRole("button",{name:"Check profile codes"}).click();
  await page.waitForFunction(()=>typeof window.finishLookup==="function");
  await area.fill("Profile Code\tQuantity (pcs)\tLength (m)\nAL-101\t200\t6");
  await page.evaluate(()=>window.finishLookup());
  await expect(page.getByRole("button",{name:"Import 1 lines into draft"})).toBeDisabled();
  await expect(page.locator("[data-quote-line]")).toHaveCount(1);
});

test("changing cut length recalculates theoretical quantity and manual kg/m has honest provenance",async()=>{
  const first=page.locator("[data-quote-line]").first();
  await first.getByRole("combobox",{name:"Profile",exact:true}).selectOption("profile-a");
  await first.getByLabel("Qty pcs",{exact:true}).fill("100");await first.getByLabel("Length m",{exact:true}).fill("6");
  await expect(first).toContainText("480.000 kg");
  await first.getByLabel("Length m",{exact:true}).fill("3");await expect(first).toContainText("240.000 kg");
  await first.getByLabel("Kg/m",{exact:true}).fill("1");
  await expect(first).toContainText(/manual/i);
  await expect(first).toContainText("300.000 kg");
  await first.getByLabel("Kg/m",{exact:true}).fill("");await expect(first).toContainText("Section weight is missing");
  assert.deepEqual(await page.evaluate(()=>window.writes),[]);
});
