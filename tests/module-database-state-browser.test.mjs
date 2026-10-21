import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

const root = process.cwd();
const aliases = new Map([
  ["@/components/ui/button", `export function Button({children,...props}) { return <button {...props}>{children}</button>; }`],
  ["@/components/data", `
    export function DataPageLayout({title,actions,children}) { return <main><h1>{title}</h1><div>{actions}</div>{children}</main>; }
    export function DataTableToolbar({search,onSearchChange,filters}) { return <section><input aria-label="Search" value={search} onChange={event => onSearchChange(event.target.value)} />{filters}</section>; }
    export function StatusFilter({label,value,onChange,options}) { return <label>{label}<select aria-label={label} value={value} onChange={event => onChange(event.target.value)}><option value="">All</option>{options.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>; }
    export function DateRangeFilter() { return null; }
    export function DataTable({rows,columns,onSort}) { return <div>{columns.map(column => <button key={column.id} onClick={() => onSort(column.id,"asc")}>Sort {column.header}</button>)}{rows.map(row => <div key={row.id}>{row.order_number}</div>)}</div>; }
    export function DataTablePagination({page,onNext}) { return <div><span>Page {page}</span><button onClick={onNext}>Next</button></div>; }
  `],
  ["@/lib/supabase/browser", `export function createClient() { return { rpc: async (_name,args) => { window.lastRpcArgs=args; window.rpcCalls=(window.rpcCalls??0)+1; return {data:{rows:[{id:"order-1",order_number:"ORD-2026-05"}],count:33},error:null}; } }; }`],
  ["@/lib/hooks/use-debounce", `import {useEffect,useState} from "react"; export function useDebounce(value,delay) { const [result,setResult]=useState(value); useEffect(()=>{const id=setTimeout(()=>setResult(value),delay);return()=>clearTimeout(id)},[value,delay]);return result; }`],
  ["@/lib/utils/errors", `export function getErrorMessage(error,fallback) { return error?.message ?? fallback; }`],
  ["@/types/app", `export function labelize(value) { return value.replace(/_/g," ").replace(/\\b\\w/g,char=>char.toUpperCase()); }`],
  ["./value", `export function displayValue(row,path) { return path.split(".").reduce((value,key)=>value?.[key],row) ?? ""; }`],
  ["./module-config", `
    const columns=[{id:"order_number",header:"Order Number",path:"order_number",sortable:true,type:"text"},{id:"current_stage",header:"Stage",path:"current_stage",sortable:true,type:"text"},{id:"priority",header:"Priority",path:"priority",sortable:true,type:"text"}];
    const config={basePath:"/orders",title:"Orders",databaseTitle:"Orders Database",defaultSort:{column:"order_number",direction:"asc"},columns,card:{titlePath:"order_number"},groupField:"current_stage",groups:["order_confirmed","packing"],secondaryFilter:{field:"priority",label:"Priority",options:[{value:"high",label:"High"},{value:"normal",label:"Normal"}]},searchPlaceholder:"Search orders"};
    export function getModuleConfig(){return config;}
  `],
  ["@/lib/preferences/table-columns", `export function getRoleColumnOrder(_key,_role,columns){return columns.map(item=>item.id);} export function moveColumn(columns){return [...columns];} export function resolveColumnLayout(_key,_role,columns,preferences){const identifier=columns[0]?.id??"";const hidden=new Set(preferences?.hidden??[]);return {columns:columns.filter(column=>column.id===identifier||!hidden.has(column.id)),permittedColumns:[...columns],widths:preferences?.widths??{},identifier};}`],
  ["@/lib/preferences/workspace-preferences", `
    export const MAX_SAVED_VIEWS=20; export function getWorkspaceStorage(){return null;} export function makeViewState(params){return {search:params.get("search")??"",status:params.get("status")??"",secondary:params.get("secondary")??"",dateFrom:params.get("dateFrom")??"",dateTo:params.get("dateTo")??"",page:Number(params.get("page")??1),sort:params.get("sort")??"order_number",direction:params.get("direction")==="desc"?"desc":"asc",relationFilters:{}};} export function mergeWorkspacePreferenceChanges(_previous,next){return next;} export function readWorkspacePreferences(){return {pinned:[],recent:[],views:[],columns:{}};} export function upsertWorkspaceLink(items,link){return [link,...items];} export function viewStateParams(state){const params=new URLSearchParams();for(const key of ["search","status","secondary","dateFrom","dateTo"])if(state[key])params.set(key,state[key]);if(state.page>1)params.set("page",String(state.page));if(state.sort)params.set("sort",state.sort);if(state.direction!=="asc")params.set("direction",state.direction);return params;} export function workspaceListUrl(path,search,state,fields){const params=new URLSearchParams(search);for(const key of ["search","status","secondary","dateFrom","dateTo","page","sort","direction",...fields])params.delete(key);for(const [key,value] of viewStateParams(state))params.set(key,value);return path+(params.size?"?"+params.toString():"");} export function workspacePreferenceKey(){return "test";} export function writeWorkspacePreferences(){}
  `],
  ["sonner", `export const toast={error(){},success(){}};`],
  ["next/link", `export default function Link({href,children,...props}) { return <a href={href} {...props}>{children}</a>; }`],
  ["next/navigation", `export function useSearchParams(){return new URLSearchParams(window.location.search);}`]
]);

// Exercise the actual preference and permission helpers with browser Storage.
aliases.delete("@/lib/preferences/workspace-preferences");
aliases.delete("@/lib/preferences/table-columns");

test("mounted database controls preserve rapid edits, debounce, pagination, sorting, and Back restoration", async () => {
  const bundle = await build({
    stdin: { contents: `import React from "react"; import {createRoot} from "react-dom/client"; import {ModuleDatabaseClient} from ${JSON.stringify(resolve(root,"components/modules/operations/module-database-client.tsx"))}; const root=createRoot(document.getElementById("root")); window.mountDatabase=(context={companyId:"company",userId:"user",role:"owner"})=>root.render(React.createElement(ModuleDatabaseClient,{moduleKey:"orders",context,canCreate:false}));`, resolveDir: root, sourcefile: "database-test-entry.tsx", loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", tsconfigRaw: { compilerOptions: { baseUrl: root, paths: { "@/*": ["./*"] } } },
    plugins: [{ name: "database-fixture-mocks", setup(build) { for (const [specifier] of aliases) build.onResolve({ filter: new RegExp(`^${specifier.replace(/[.*+?^${}()|[\\]\\]/g,"\\$&")}$`) }, () => ({ path: specifier, namespace: "fixture" })); build.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: aliases.get(args.path), loader: "tsx", resolveDir: root })); } }]
  });
  const browserPath = process.env.CHROME_PATH ?? [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
  ].find((candidate) => existsSync(candidate));
  const browser = await chromium.launch({ headless: true, ...(browserPath ? { executablePath: browserPath } : {}) });
  try {
    const page = await browser.newPage();
    await page.route("https://workspace.fixture/**", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
    await page.goto("https://workspace.fixture/orders/database?search=ORD-2026-04&status=packing&secondary=normal");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => window.mountDatabase());
    await page.getByRole("heading", { name: "Orders Database" }).waitFor();
    await page.getByText("Columns", { exact: true }).click();
    await page.getByRole("checkbox", { name: "Priority" }).uncheck();
    await page.getByRole("button", { name: "Sort Priority" }).waitFor({ state: "detached" });
    await page.getByRole("checkbox", { name: "Priority" }).check();
    await page.getByRole("button", { name: "Sort Priority" }).waitFor();
    await page.getByText("Columns", { exact: true }).click();
    await page.getByLabel("Search").fill("ORD-2026-05");
    await page.getByRole("combobox", { name: "Current Stage", exact: true }).selectOption("order_confirmed");
    await page.getByRole("combobox", { name: "Priority", exact: true }).selectOption("high");
    await page.getByRole("button", { name: "Sort Order Number" }).click();
    await page.getByRole("button", { name: "Next" }).click();
    await page.waitForTimeout(450);
    const current = await page.evaluate(() => ({ url: location.href, rpc: window.lastRpcArgs }));
    const query = new URL(current.url).searchParams;
    assert.equal(query.get("search"), "ORD-2026-05");
    assert.equal(query.get("status"), "order_confirmed");
    assert.equal(query.get("secondary"), "high");
    assert.equal(query.get("page"), "2");
    assert.equal(query.get("sort"), "order_number");
    assert.equal(current.rpc.p_search, "ORD-2026-05");
    assert.equal(current.rpc.p_filters.status, "order_confirmed");
    assert.equal(current.rpc.p_filters.secondary, "high");
    assert.equal(current.rpc.p_page, 2);
    await page.evaluate(() => history.pushState(null, "", "/orders/order-1"));
    await page.goBack();
    await page.getByLabel("Search").waitFor();
    await page.waitForTimeout(450);
    assert.equal(await page.getByLabel("Search").inputValue(), "ORD-2026-05");
    assert.equal(await page.getByRole("combobox", { name: "Current Stage", exact: true }).inputValue(), "order_confirmed");
    assert.equal(await page.getByRole("combobox", { name: "Priority", exact: true }).inputValue(), "high");
    assert.equal(new URL(page.url()).searchParams.get("page"), "2");
    await page.getByText("Columns", { exact: true }).click();
    await page.getByRole("checkbox", { name: "Priority", exact: true }).uncheck();
    await page.getByRole("button", { name: "Sort Priority" }).waitFor({ state: "detached" });
    const callsBeforeSwitch = await page.evaluate(() => window.rpcCalls);
    await page.evaluate(() => window.mountDatabase({ companyId: "other-company", userId: "other-user", role: "owner" }));
    await page.getByRole("button", { name: "Sort Priority" }).waitFor();
    assert.equal(await page.getByRole("checkbox", { name: "Priority", exact: true }).isChecked(), true);
    assert.ok(await page.evaluate(() => window.rpcCalls) > callsBeforeSwitch, "Scope changes must request a fresh page");
    await page.evaluate(() => window.mountDatabase({ companyId: "company", userId: "user", role: "owner" }));
    await page.getByRole("button", { name: "Sort Priority" }).waitFor({ state: "detached" });
    assert.equal(await page.getByRole("checkbox", { name: "Priority", exact: true }).isChecked(), false);
  } finally {
    await browser.close();
  }
});
