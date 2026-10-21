import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

const root = process.cwd();
const fixtureModules = new Map([
  ["./module-config", `export function getModuleConfig() { return { title: "Orders", basePath: "/orders", resource: "orders" }; }`],
  ["@/lib/auth/permissions", `export function can(role) { return role !== "blocked"; }`],
  ["next/link", `import React from "react"; export default function Link({ href, children, ...props }) { return React.createElement("a", { href, ...props }, children); }`],
  ["lucide-react", `import React from "react"; export function X() { return React.createElement("span", { "aria-hidden": true }, "x"); }`]
]);

test("mounted record preview traps focus, restores the row trigger, preserves return state, and hides stale/private data", async () => {
  const bundle = await build({
    stdin: {
      contents: `import React, { useRef, useState } from "react"; import { createRoot } from "react-dom/client"; import { RecordPreview } from ${JSON.stringify(resolve(root, "components/modules/operations/record-preview.tsx"))}; const root=createRoot(document.getElementById("root")); window.scope=JSON.stringify(["c1","u1","owner"]); window.mount=(context={companyId:"c1",userId:"u1",role:"owner"},rowScope=window.scope)=>{function Harness(){const [open,setOpen]=useState(true);const trigger=useRef(null);window.closePreview=()=>setOpen(false);return React.createElement(React.Fragment,null,React.createElement("button",{id:"row-trigger",ref:trigger,onClick:()=>setOpen(true)},"Open ORD-17"),React.createElement(RecordPreview,{open,moduleKey:"orders",context,rowScope,triggerRef:trigger,row:{id:"order-17",order_number:"ORD-17",current_stage:"packing",order_value:80000,internal_notes:"Private note",customers:{company_name:"Kaveri Systems"}},returnTo:"/orders/database?search=ORD-17&page=3&sort=order_number",onClose:()=>setOpen(false)}));} root.render(React.createElement(Harness));};`,
      resolveDir: root,
      sourcefile: "record-preview-fixture.tsx",
      loader: "tsx"
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    tsconfigRaw: { compilerOptions: { baseUrl: root, paths: { "@/*": ["./*"] } } },
    plugins: [{
      name: "record-preview-fixture-modules",
      setup(buildApi) {
        for (const [specifier] of fixtureModules) buildApi.onResolve({ filter: new RegExp(`^${specifier.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}$`) }, () => ({ path: specifier, namespace: "fixture" }));
        buildApi.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({ contents: fixtureModules.get(args.path), loader: "tsx", resolveDir: root }));
      }
    }]
  });

  const browserPath = process.env.CHROME_PATH ?? [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
  ].find((candidate) => existsSync(candidate));
  const browser = await chromium.launch({ headless: true, ...(browserPath ? { executablePath: browserPath } : {}) });
  try {
    const page = await browser.newPage();
    await page.setContent('<main id="background"><button id="before">Background control</button><div id="root"></div></main>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => window.mount());
    const trigger = page.getByRole("button", { name: "Open ORD-17" });
    await page.getByRole("dialog", { name: /ORD-17/ }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Close record preview" }).evaluate((element) => element === document.activeElement), true);
    assert.equal(await page.locator("#background").evaluate((element) => element.inert), true);
    const link = page.getByRole("link", { name: "Open full record" });
    assert.match(await link.getAttribute("href"), /returnTo=.*search%3DORD-17.*page%3D3.*sort%3Dorder_number/);
    const panelText = await page.getByRole("dialog").innerText();
    assert.match(panelText, /Kaveri Systems/);
    assert.doesNotMatch(panelText, /80000|Private note|internal_notes/i);
    await page.keyboard.press("Shift+Tab");
    assert.equal(await link.evaluate((element) => element === document.activeElement), true);
    await page.keyboard.press("Tab");
    assert.equal(await page.getByRole("button", { name: "Close record preview" }).evaluate((element) => element === document.activeElement), true);
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });
    assert.equal(await trigger.evaluate((element) => element === document.activeElement), true);
    assert.equal(await page.locator("#background").evaluate((element) => element.inert), false);

    await trigger.click();
    await page.getByRole("dialog", { name: /ORD-17/ }).waitFor();
    await page.evaluate(() => window.mount({ companyId: "c2", userId: "u2", role: "owner" }, window.scope));
    await page.getByText("Loading this record…", { exact: true }).waitFor();
    assert.doesNotMatch(await page.getByRole("dialog").innerText(), /ORD-17|Kaveri Systems|80000|Private note/);
  } finally {
    await browser.close();
  }
});
