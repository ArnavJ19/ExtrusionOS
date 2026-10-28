import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

let browser;
let page;
let script;

const createdCustomer = {
  id: "customer-new",
  customer_name: "Mira Shah",
  company_name: "Mira Fabrication",
  customer_type: "fabricator",
  phone: "9876543210",
  email: "mira@example.test",
  gst_number: null,
  billing_address: null,
  shipping_address: null,
  city: null,
  is_active: true,
};

const possibleMatch = {
  ...createdCustomer,
  id: "customer-existing",
  customer_name: "Mira Shah Works",
  company_name: "Mira Fabrication",
  matched_on: ["company name"],
};

const mocks = {
  "@/lib/supabase/browser": `
    const profile={id:"profile-a",profile_code:"AL-101",profile_name:"Window section",section_weight_kg_per_m:0.8,section_perimeter_mm:120,drawing_revision:"A",drawing_approval_status:"approved"};
    export function createClient(){return {from(table){const q={table,filters:[],single:false};const chain={
      select(){return this;},eq(key,value){q.filters.push([key,value]);return this;},is(key,value){q.filters.push([key,value]);return this;},order(){return this;},limit(){return this;},or(){return this;},ilike(){return this;},
      in(key,values){q.filters.push([key,values]);return this;},maybeSingle(){q.single=true;return this;},
      then(resolve,reject){window.databaseReads.push(q);let data=[];if(table==="aluminium_profiles")data=[profile];else if(table==="company_settings_authorized")data={default_conversion_charge_per_kg:30,default_packing_charge:20,default_transport_charge:10,default_margin_percent:10,minimum_margin_percent:8,default_gst_percent:18};return Promise.resolve({data,error:null}).then(resolve,reject);}
    };return chain;}};}
  `,
  "@/lib/actions/quotes-orders": `export async function saveQuoteAction(data){window.quoteWrites.push(data);return {success:true};} export async function updateQuoteStatusAction(){throw new Error("Unexpected workflow write");}`,
  "@/lib/actions/in-task-customers": `export async function inTaskCustomerAction(request){window.customerActions.push(request);if(window.customerAction)return window.customerAction(request);return {kind:"checked",matches:[],hasMore:false};}`,
  "@/lib/actions/costing-rates": `export async function costingRateAction(){throw new Error("Unexpected costing rate request");}`,
  "@/lib/actions/repeat-quote": `export async function repeatQuoteAction(){return {success:false,error:"No repeat source in this fixture"}}`,
  "sonner": `export const toast={error(message){window.toastErrors.push(String(message));},success(message){window.toastSuccesses.push(String(message));},warning(){}};`,
};

function resolveAliasFile(alias) {
  const base = path.resolve(process.cwd(), alias.slice(2));
  const candidates = [base, ...[".tsx", ".ts", ".jsx", ".js"].map((extension) => `${base}${extension}`), ...["index.tsx", "index.ts", "index.jsx", "index.js"].map((name) => path.join(base, name))];
  return candidates.find(existsSync) ?? base;
}

test.before(async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(), sourcefile: "in-task-customer-fixture.tsx", loader: "tsx", contents: `
        import React from "react"; import {createRoot} from "react-dom/client";
        import {QuotesClient} from "./components/modules/quotes-client";
        window.quoteWrites=[];window.customerActions=[];window.databaseReads=[];window.toastErrors=[];window.toastSuccesses=[];
        window.quoteRoot=createRoot(document.getElementById("app"));
        window.renderQuote=context=>window.quoteRoot.render(context?<QuotesClient context={context} mode="form"/>:null);
        window.renderQuote({companyId:"company-a",userId:"user-a",role:"owner"});
      `,
    },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    plugins: [{
      name: "in-task-customer-browser-fixture",
      setup(buildApi) {
        buildApi.onResolve({ filter: /^@\/lib\/(?:supabase\/browser|actions\/(?:quotes-orders|in-task-customers|repeat-quote|costing-rates))$/ }, (args) => ({ path: args.path, namespace: "fixture" }));
        buildApi.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({ contents: mocks[args.path], loader: "tsx", resolveDir: process.cwd() }));
        buildApi.onResolve({ filter: /^@\// }, (args) => ({ path: resolveAliasFile(args.path) }));
        buildApi.onResolve({ filter: /^sonner$/ }, (args) => ({ path: args.path, namespace: "fixture" }));
        buildApi.onLoad({ filter: /^sonner$/, namespace: "fixture" }, (args) => ({ contents: mocks[args.path], loader: "tsx", resolveDir: process.cwd() }));
      },
    }],
  });
  script = bundle.outputFiles[0].text;
  const chromePath = process.env.CHROME_PATH ?? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
  browser = await chromium.launch({ headless: true, ...(chromePath ? { executablePath: chromePath } : {}) });
});

test.beforeEach(async () => {
  page = await browser.newPage();
  page.setDefaultTimeout(5000);
  page.on("pageerror", (error) => console.error("in-task-customer browser page error:", error));
  await page.setContent('<main id="app"></main>');
  await page.evaluate(() => {
    globalThis.process = { env: { NODE_ENV: "test", __NEXT_IMAGE_OPTS: { deviceSizes: [], imageSizes: [], path: "/_next/image", loader: "default", domains: [], disableStaticImages: false, minimumCacheTTL: 60, formats: [], dangerouslyAllowSVG: false, contentSecurityPolicy: "", contentDispositionType: "attachment", remotePatterns: [], unoptimized: false } } };
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: { randomUUID: () => "123e4567-e89b-42d3-a456-426614174000" } });
  });
  await page.addScriptTag({ content: script });
  await page.getByRole("heading", { name: "Quote creation" }).waitFor();
  await page.getByText("Terms and internal notes", { exact: true }).click();
  await page.getByText("Costing and recovery for item 1", { exact: true }).click();
  await page.getByRole("textbox", { name: "Terms and conditions", exact: true }).waitFor();
});

test.afterEach(async () => { await page?.close(); });
test.after(async () => { await browser?.close(); });

async function fillDraft() {
  const line = page.locator("[data-quote-line]").first();
  await line.getByLabel("Qty pcs", { exact: true }).fill("17");
  await line.getByLabel("Length m", { exact: true }).fill("4.25");
  await line.getByLabel("Sales override", { exact: true }).fill("8123");
  await page.getByRole("textbox", { name: "Terms and conditions", exact: true }).fill("Keep the existing commercial terms.");
  await page.getByRole("textbox", { name: "Notes", exact: true }).fill("Draft operator note.");
}

async function snapshotDraft() {
  const line = page.locator("[data-quote-line]").first();
  return {
    lines: await page.locator("[data-quote-line]").count(),
    quantity: await line.getByLabel("Qty pcs", { exact: true }).inputValue(),
    length: await line.getByLabel("Length m", { exact: true }).inputValue(),
    price: await line.getByLabel("Sales override", { exact: true }).inputValue(),
    terms: await page.getByRole("textbox", { name: "Terms and conditions", exact: true }).inputValue(),
    notes: await page.getByRole("textbox", { name: "Notes", exact: true }).inputValue(),
  };
}

async function openCustomerDialog() {
  await page.getByRole("button", { name: "Add new customer" }).click();
  const dialog = page.getByRole("dialog", { name: "Add customer to this quotation" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("cancel preserves unsaved quote lines, price and terms; dialog opens focused and Escape restores focus", async () => {
  await fillDraft();
  const before = await snapshotDraft();
  const trigger = page.getByRole("button", { name: "Add new customer" });
  const dialog = await openCustomerDialog();
  await expect(dialog.getByLabel("Customer name *", { exact: true })).toBeFocused();
  await dialog.getByLabel("Customer name *", { exact: true }).fill("Temporary entry");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  assert.deepEqual(await snapshotDraft(), before);
  assert.deepEqual(await page.evaluate(() => window.quoteWrites), []);
});

test("create and select merge the returned customer into the live quote without saving the quote", async () => {
  await fillDraft();
  await page.evaluate((customer) => {
    window.customerAction = async (request) => request.intent === "check"
      ? { kind: "checked", matches: [], hasMore: false }
      : { kind: "created", customer };
  }, createdCustomer);
  const dialog = await openCustomerDialog();
  await dialog.getByLabel("Customer name *", { exact: true }).fill(createdCustomer.customer_name);
  await dialog.getByLabel("Company name", { exact: true }).fill(createdCustomer.company_name);
  await dialog.getByLabel("Phone", { exact: true }).fill(createdCustomer.phone);
  await dialog.getByRole("button", { name: "Check existing customers" }).click();
  await expect(dialog.getByText(/No likely match was found/)).toBeVisible();
  await dialog.getByRole("button", { name: "Create customer and select" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Selected: Mira Fabrication · Mira Shah")).toBeVisible();
  await expect(page.getByPlaceholder("Search customer name, company, or GST...")).toHaveValue("Mira Fabrication · Mira Shah");
  assert.deepEqual(await page.evaluate(() => window.customerActions.map((request) => request.intent)), ["check", "create"]);
  assert.deepEqual(await page.evaluate(() => window.quoteWrites), []);
  assert.deepEqual(await snapshotDraft(), { lines: 1, quantity: "17", length: "4.25", price: "8123", terms: "Keep the existing commercial terms.", notes: "Draft operator note." });
});

test("a new customer without a company name is labelled once and preserves the draft", async () => {
  await fillDraft();
  const before = await snapshotDraft();
  await page.evaluate((customer) => { window.customerAction = async () => ({ kind: "created", customer: { ...customer, company_name: null } }); }, createdCustomer);
  const dialog = await openCustomerDialog();
  await dialog.getByLabel("Customer name *", { exact: true }).fill(createdCustomer.customer_name);
  await dialog.getByRole("button", { name: "Create customer and select" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Selected: Mira Shah", { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder("Search customer name, company, or GST...")).toHaveValue("Mira Shah");
  assert.deepEqual(await snapshotDraft(), before);
  assert.deepEqual(await page.evaluate(() => window.quoteWrites), []);
});

test("similar matches require acknowledgement and a fresh acknowledgement after recheck", async () => {
  await page.evaluate((match) => {
    let creates = 0;
    window.customerAction = async (request) => {
      if (request.intent === "check") return { kind: "checked", matches: [match], hasMore: false };
      if (request.intent === "create" && creates++ === 0) return { kind: "similar", matches: [match], hasMore: false };
      if (request.intent === "create") return { kind: "created", customer: { ...match, id: "customer-new" } };
      return { kind: "selected", customer: match };
    };
  }, possibleMatch);
  const dialog = await openCustomerDialog();
  await dialog.getByLabel("Customer name *", { exact: true }).fill("Mira Shah");
  await dialog.getByLabel("Company name", { exact: true }).fill("Mira Fabrication");
  await dialog.getByRole("button", { name: "Check existing customers" }).click();
  await expect(dialog.getByRole("region", { name: "Possible existing customers" })).toBeVisible();
  const createButton = dialog.getByRole("button", { name: "Create customer and select" });
  await expect(createButton).toBeDisabled();
  const acknowledgement = dialog.getByRole("checkbox", { name: /reviewed the possible matches/ });
  await acknowledgement.check();
  await createButton.click();
  await expect(acknowledgement).not.toBeChecked();
  await expect(createButton).toBeDisabled();
  await acknowledgement.check();
  await createButton.click();
  await expect(dialog).toBeHidden();
  const requests = await page.evaluate(() => window.customerActions.filter((request) => request.intent === "create"));
  assert.equal(requests.length, 2);
  assert.equal(requests[0].acknowledge_similar, true);
  assert.equal(requests[1].acknowledge_similar, true);
  assert.equal(requests[0].request_id, requests[1].request_id);
  assert.deepEqual(await page.evaluate(() => window.quoteWrites), []);
});

test("using an active match preserves the draft and leaves inactive matches unavailable", async () => {
  await fillDraft();
  const before = await snapshotDraft();
  await page.evaluate((match) => {
    window.customerAction = async (request) => request.intent === "check"
      ? { kind: "checked", matches: [{ ...match, id: "inactive", is_active: false }, match], hasMore: true }
      : { kind: "selected", customer: match };
  }, possibleMatch);
  const dialog = await openCustomerDialog();
  await dialog.getByLabel("Customer name *", { exact: true }).fill("Mira Shah");
  await dialog.getByRole("button", { name: "Check existing customers" }).click();
  const matches = dialog.getByRole("button", { name: "Use this customer" });
  await expect(matches.nth(0)).toBeDisabled();
  await expect(dialog.getByText(/Showing up to 10 matches/)).toBeVisible();
  await matches.nth(1).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Selected: Mira Fabrication · Mira Shah Works")).toBeVisible();
  assert.deepEqual(await snapshotDraft(), before);
  assert.deepEqual(await page.evaluate(() => window.customerActions.map((request) => request.intent)), ["check", "select"]);
  assert.deepEqual(await page.evaluate(() => window.quoteWrites), []);
});

test("same-event repeated create is guarded while request is pending", async () => {
  await page.evaluate(() => {
    window.customerAction = (request) => request.intent === "check"
      ? Promise.resolve({ kind: "checked", matches: [], hasMore: false })
      : new Promise((resolve) => { window.finishCustomerAction = resolve; });
  });
  const dialog = await openCustomerDialog();
  await dialog.getByLabel("Customer name *", { exact: true }).fill("One request only");
  await dialog.getByRole("button", { name: "Check existing customers" }).click();
  await page.evaluate(() => { const button = [...document.querySelectorAll("dialog button")].find((candidate) => candidate.textContent === "Create customer and select"); button.click(); button.click(); });
  await expect(dialog.getByRole("button", { name: "Working..." })).toBeDisabled();
  assert.equal(await page.evaluate(() => window.customerActions.filter((request) => request.intent === "create").length), 1);
  await page.evaluate((customer) => window.finishCustomerAction({ kind: "created", customer }), createdCustomer);
  await expect(dialog).toBeHidden();
});

test("lost-response retry reuses the unchanged request id and customer details", async () => {
  await page.evaluate((customer) => {
    let creates = 0;
    window.customerAction = async (request) => {
      if (request.intent === "check") return { kind: "checked", matches: [], hasMore: false };
      if (creates++ === 0) throw new Error("simulated lost response");
      return { kind: "created", customer };
    };
  }, createdCustomer);
  const dialog = await openCustomerDialog();
  const name = dialog.getByLabel("Customer name *", { exact: true });
  await name.fill(createdCustomer.customer_name);
  await dialog.getByLabel("Company name", { exact: true }).fill(createdCustomer.company_name);
  await dialog.getByRole("button", { name: "Check existing customers" }).click();
  await dialog.getByRole("button", { name: "Create customer and select" }).click();
  await expect(dialog.getByRole("status")).toContainText("held unchanged");
  await expect(name).toBeDisabled();
  await dialog.getByRole("button", { name: "Close customer dialog" }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("");
  await openCustomerDialog();
  await expect(name).toHaveValue(createdCustomer.customer_name);
  await expect(name).toBeDisabled();
  await dialog.getByRole("button", { name: "Check saved result" }).click();
  await expect(dialog).toBeHidden();
  const creates = await page.evaluate(() => window.customerActions.filter((request) => request.intent === "create"));
  assert.equal(creates.length, 2);
  assert.equal(creates[0].request_id, creates[1].request_id);
  assert.deepEqual(creates[0].customer, creates[1].customer);
  assert.deepEqual(await page.evaluate(() => window.quoteWrites), []);
});

test("scope changes and unmount ignore delayed create callbacks", async () => {
  await page.evaluate(() => { window.customerAction = () => new Promise((resolve) => { window.finishCustomerAction = resolve; }); });
  let dialog = await openCustomerDialog();
  await dialog.getByLabel("Customer name *", { exact: true }).fill("Old company contact");
  await dialog.getByRole("button", { name: "Create customer and select" }).click();
  await page.evaluate(() => window.renderQuote({ companyId: "company-b", userId: "user-b", role: "owner" }));
  await page.waitForFunction(() => document.querySelector("[data-quote-line]") !== null);
  await page.evaluate((customer) => window.finishCustomerAction({ kind: "created", customer }), { ...createdCustomer, id: "stale-customer" });
  await expect(page.getByPlaceholder("Search customer name, company, or GST...")).toHaveValue("");
  await expect(page.getByText(/Selected:/)).toHaveCount(0);

  await page.evaluate(() => { window.customerAction = () => new Promise((resolve) => { window.finishCustomerAction = resolve; }); });
  dialog = await openCustomerDialog();
  await dialog.getByLabel("Customer name *", { exact: true }).fill("Unmounted contact");
  await dialog.getByRole("button", { name: "Create customer and select" }).click();
  await page.evaluate(() => window.renderQuote(null));
  await page.evaluate((customer) => window.finishCustomerAction({ kind: "created", customer }), { ...createdCustomer, id: "unmounted-customer" });
  await expect(page.locator("#app")).toBeEmpty();
  assert.deepEqual(await page.evaluate(() => window.quoteWrites), []);
});

test("dialog keyboard shortcuts do not add, duplicate, or save quote lines", async () => {
  const rowsBefore = await page.locator("[data-quote-line]").count();
  const dialog = await openCustomerDialog();
  await dialog.getByLabel("Customer name *", { exact: true }).focus();
  await page.keyboard.press("Control+Alt+a");
  await page.keyboard.press("Control+Alt+d");
  await page.keyboard.press("Control+Alt+s");
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-quote-line]")).toHaveCount(rowsBefore);
  assert.deepEqual(await page.evaluate(() => window.quoteWrites), []);
  assert.deepEqual(await page.evaluate(() => window.customerActions), []);
});
