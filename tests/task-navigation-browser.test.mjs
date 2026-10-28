import { existsSync } from "node:fs";
import test from "node:test";
import { build } from "esbuild";
import { expect, chromium } from "@playwright/test";

let browser;
let page;
let fixtureScript;

test.before(async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      sourcefile: "task-navigation-fixture.tsx",
      loader: "tsx",
      contents: `
        import React, { useState } from "react";
        import { createRoot } from "react-dom/client";
        import { TaskNavigation } from "./components/layout/task-navigation";
        window.__taskNavigation = {};
        function Fixture() {
          const [pathname, setPathname] = useState("/shipments");
          window.__taskNavigation.navigate = (nextPath) => setPathname(nextPath);
          return <>
            <TaskNavigation model={{
              primary: [{ href: "/dispatches", label: "Dispatches", icon: "Truck", aliases: ["/shipments"] }],
              more: [{ label: "Stock", items: [
                { href: "/inventory", label: "Inventory", icon: "Boxes", roles: ["owner"] },
                ...Array.from({ length: 8 }, (_, index) => ({ href: "/stock-" + index, label: "Stock " + index, icon: "Boxes", roles: ["owner"] }))
              ] }]
            }} mobileShortcuts={<details><summary>Workspace</summary><a href="/pinned">Pinned work</a></details>} />
            <a href="#after" id="after-menu">After menu</a>
          </>;
        }
        createRoot(document.getElementById("app")).render(<Fixture/>);
      `
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{
      name: "mock-next-navigation",
      setup(plugin) {
        plugin.onResolve({ filter: /^next\/link$/ }, () => ({ path: "next-link", namespace: "fixture" }));
        plugin.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "next-navigation", namespace: "fixture" }));
        plugin.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          loader: "js",
          resolveDir: process.cwd(),
          contents: args.path === "next-link" ? `
            import React from "react";
            import { navigate } from "next/navigation";
            export default function Link({ href, children, onClick, ...props }) {
              return React.createElement("a", { ...props, href, onClick(event) {
                onClick?.(event);
                if (!event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey) {
                  event.preventDefault(); navigate(href);
                }
              } }, children);
            }
          ` : `
            import { useEffect, useState } from "react";
            let pathname = "/shipments";
            const subscribers = new Set();
            export function usePathname() {
              const [current, setCurrent] = useState(pathname);
              useEffect(() => { subscribers.add(setCurrent); return () => subscribers.delete(setCurrent); }, []);
              return current;
            }
            export function navigate(nextPath) {
              pathname = nextPath;
              subscribers.forEach((setCurrent) => setCurrent(pathname));
            }
          `
        }));
      }
    }]
  });

  fixtureScript = bundle.outputFiles[0].text;
  const browserPath = process.env.CHROME_PATH ?? [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
  ].find((candidate) => existsSync(candidate));
  browser = await chromium.launch({ headless: true, ...(browserPath ? { executablePath: browserPath } : {}) });
});

test.beforeEach(async () => {
  page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.setContent(`<!doctype html><html><head><style>
    body { margin: 0; } #app { padding: 24px; }
    #task-navigation-more { overflow-y: auto; background: white; }
    #task-navigation-more nav a { display: block; min-height: 40px; }
    @media (max-width: 600px) { nav[aria-label="Primary task navigation"] { position: fixed; bottom: 8px; } }
  </style></head><body><main id="app"></main></body></html>`);
  await page.addScriptTag({ content: fixtureScript });
  await page.getByRole("link", { name: "Dispatches" }).waitFor();
});

test.afterEach(async () => {
  await page?.close();
});

test.after(async () => {
  await browser?.close();
});

test("More opens on the first permitted destination and reverse Tab returns to its trigger", async () => {
  const trigger = page.getByRole("button", { name: "More" });
  const menu = page.getByRole("navigation", { name: "More task destinations" });
  await expect(page.getByRole("link", { name: "Dispatches" })).toHaveAttribute("aria-current", "page");
  await trigger.click();
  await expect(menu).toBeVisible();
  await expect(page.getByRole("link", { name: "Inventory" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByText("Workspace", { exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(trigger).toBeFocused();
});

test("internal portal scrolling keeps lower destination focus and scroll position", async () => {
  await page.setViewportSize({ width: 375, height: 360 });
  await page.getByRole("button", { name: "More" }).click();
  await expect(page.getByRole("navigation", { name: "More task destinations" })).toBeVisible();
  await expect(page.locator('#task-navigation-more a[href="/stock-7"]')).toHaveCount(1);
  const state = await page.evaluate(async () => {
    const panel = document.querySelector("#task-navigation-more");
    const lastDestination = panel?.querySelector('a[href="/stock-7"]');
    if (!panel || !lastDestination) throw new Error("Expected the More portal and its final destination");
    panel.scrollTop = panel.scrollHeight;
    lastDestination.focus({ preventScroll: true });
    const scrollTop = panel.scrollTop;
    panel.dispatchEvent(new Event("scroll", { bubbles: true }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { focusedHref: document.activeElement?.getAttribute("href"), scrollTop, afterScrollTop: panel.scrollTop };
  });
  expect(state.focusedHref).toBe("/stock-7");
  expect(state.afterScrollTop).toBe(state.scrollTop);
});

test("Escape closes More and restores focus to its trigger", async () => {
  const trigger = page.getByRole("button", { name: "More" });
  await trigger.click();
  await expect(page.getByRole("link", { name: "Inventory" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("navigation", { name: "More task destinations" })).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("Tab from the last menu destination exits after the trigger and closes More", async () => {
  await page.getByRole("button", { name: "More" }).click();
  const lastDestination = page.getByRole("link", { name: "Stock 7" });
  await lastDestination.focus();
  await expect(lastDestination).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator("#after-menu")).toBeFocused();
  await expect(page.getByRole("navigation", { name: "More task destinations" })).toHaveCount(0);
});

test("activating a More destination closes the portal and updates alias active state", async () => {
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("link", { name: "Inventory" }).click();
  await expect(page.getByRole("navigation", { name: "More task destinations" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Dispatches" })).not.toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "More" }).click();
  await expect(page.getByRole("link", { name: "Inventory" })).toHaveAttribute("aria-current", "page");
});
