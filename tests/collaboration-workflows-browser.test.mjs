import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import { createCollaborationBrowserFixture } from "../scripts/lib/collaboration-browser-fixture.mjs";
import { ids, id } from "../scripts/lib/collaboration-workflow-fixture.mjs";
let f, browser, page, errors;
test.before(async () => { f = await createCollaborationBrowserFixture(); const executablePath = process.env.CHROME_PATH ?? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync); browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) }); });
test.beforeEach(async () => { await f.reset(); page = await browser.newPage(); page.setDefaultTimeout(10000); errors = []; page.on("pageerror", error => errors.push(error.message)); });
test.afterEach(async () => { await page.close(); assert.deepEqual(errors, []); });
test.after(async () => { await browser?.close(); await f?.close(); });

test("the mounted discussion posts a mention through the actual action and retains replies", async () => {
  await page.goto(`${f.base}/discussion`); await expect(page.getByText("No messages recorded.", { exact: true })).toBeVisible();
  await page.getByText("Add an internal message", { exact: true }).click();
  await page.getByLabel("Message", { exact: true }).fill("Use the approved drawing revision B");
  await page.getByLabel("Supporting reference or decision", { exact: true }).fill("Drawing B / technical approval");
  await page.getByLabel("Mention colleague", { exact: true }).selectOption(ids.colleague);
  await page.getByRole("button", { name: "Post internal message", exact: true }).click();
  await expect(page.getByText("Use the approved drawing revision B", { exact: true })).toBeVisible();
  await expect(page.getByText("Mentioned: Colleague", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Reply to Mira Sales", exact: true }).click();
  await page.getByLabel("Message", { exact: true }).fill("Confirmed against the traveller"); await page.getByRole("button", { name: "Post internal message", exact: true }).click();
  await expect(page.getByRole("link", { name: "Open the earlier message", exact: true })).toBeVisible();
  assert.equal((await f.db.query("select count(*)::int n from notifications")).rows[0].n, 1);
  assert.equal((await f.db.query("select count(*)::int n from record_discussions where reply_to is not null")).rows[0].n, 1);
});
test("a lost discussion acknowledgement locks fields and retries the original identity once", async () => {
  await page.goto(`${f.base}/discussion`); await page.getByText("Add an internal message", { exact: true }).click();
  await page.getByLabel("Message", { exact: true }).fill("Retain this observed handover"); f.controls.loseNextWrite = true;
  await page.getByRole("button", { name: "Post internal message", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry the same request", exact: true })).toBeVisible(); await expect(page.getByLabel("Message", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Retry the same request", exact: true }).click();
  await expect(page.getByText("Retain this observed handover", { exact: true })).toBeVisible(); await expect(page.getByLabel("Message", { exact: true })).toHaveValue("");
  assert.equal((await f.db.query("select count(*)::int n from record_discussions")).rows[0].n, 1);
});
test("the actual procedure create and reassignment screens preserve accountable owner history", async () => {
  await page.goto(`${f.base}/tasks/procedures/new`);
  await page.getByLabel("Procedure title", { exact: true }).fill("Press opening"); await page.getByLabel("Station or business scope", { exact: true }).fill("Press 1");
  await page.getByLabel("Purpose and clarification route", { exact: true }).fill("Review the handover; ask the process owner for unclear cases");
  await page.getByLabel("Process backup", { exact: true }).selectOption(ids.colleague); await page.getByLabel("Routine use", { exact: true }).selectOption("opening");
  await page.getByLabel("Required observation prompts, one per line", { exact: false }).fill("Confirm the physical handover");
  await page.getByRole("button", { name: "Save operating procedure", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Press opening", exact: true })).toBeVisible();
  await expect(page.getByText("Process owner: Mira Sales", { exact: true })).toBeVisible();
  await page.getByText("Change procedure ownership or routine", { exact: true }).click();
  await page.getByLabel("Process backup", { exact: true }).selectOption(""); await page.getByLabel("Process owner", { exact: true }).selectOption(ids.colleague);
  await page.getByLabel("Reason for ownership or method change", { exact: true }).fill("New shift owner takes over the method");
  await page.getByRole("button", { name: "Save operating procedure", exact: true }).click();
  await expect(page.getByText("Process owner: Colleague", { exact: true })).toBeVisible(); await expect(page.getByText("Mira Sales → Colleague", { exact: true })).toBeVisible();
  assert.equal((await f.db.query("select count(*)::int n from operating_procedure_events")).rows[0].n, 2);
});
test("daily run generation and actual observations close only the routine and retain unfinished work", async () => {
  await f.seed(); await page.goto(`${f.base}/tasks/procedures/${id(1000)}`);
  await page.getByRole("button", { name: "Generate today's opening routine", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your unfinished assigned tasks", exact: true })).toBeVisible();
  await expect(page.getByText("Confirm rack handover · open", { exact: true })).toBeVisible();
  await page.getByLabel("Observation 1 result", { exact: true }).selectOption("follow_up"); await page.getByLabel("Observation 1 note", { exact: true }).fill("Supervisor must inspect the rack handover");
  await page.getByLabel("Handover outcome and unfinished work", { exact: true }).fill("Carry the open task to the next shift");
  await page.getByRole("checkbox").check(); await page.getByRole("button", { name: "Complete routine review", exact: true }).click();
  await expect(page.getByText("Carry the open task to the next shift", { exact: true })).toBeVisible();
  assert.equal((await f.db.query("select count(*)::int n from daily_routine_runs")).rows[0].n, 1);
  assert.equal((await f.db.query("select status from tasks where id=$1", [id(90)])).rows[0].status, "open");
});
test("stale routine context refuses completion and refresh requires renewed acknowledgement", async () => {
  await f.seed(); await page.goto(`${f.base}/tasks/routines/${id(2000)}`);
  await page.getByLabel("Observation 1 result", { exact: true }).selectOption("confirmed"); await page.getByLabel("Handover outcome and unfinished work", { exact: true }).fill("Work reviewed"); await page.getByRole("checkbox").check();
  await f.db.exec("update tasks set status='in_progress',updated_at=now() where title='Confirm rack handover'");
  await page.getByRole("button", { name: "Complete routine review", exact: true }).click(); await expect(page.getByRole("alert")).toContainText("Work context changed");
  await page.getByRole("button", { name: "Refresh", exact: true }).click(); await expect(page.getByRole("checkbox")).not.toBeChecked();
  assert.equal((await f.db.query("select count(*)::int n from daily_routine_completions")).rows[0].n, 0);
});
test("read failures, missing migrations and viewer screens fail explicitly", async () => {
  f.controls.unavailable = true; await page.goto(`${f.base}/discussion`); await expect(page.getByRole("alert").first()).toContainText("database upgrade");
  await page.getByText("Add an internal message", { exact: true }).click(); await expect(page.getByRole("button", { name: "Post internal message", exact: true })).toBeDisabled();
  f.controls.unavailable = false; f.controls.failRead = true; await page.goto(`${f.base}/tasks/procedures`); await expect(page.getByRole("alert")).toContainText("unavailable");
  f.controls.failRead = false; await page.goto(`${f.base}/discussion?role=viewer`); await expect(page.getByText("No messages recorded.", { exact: true })).toBeVisible(); await expect(page.getByText("Add an internal message", { exact: true })).toHaveCount(0);
});
test("essential quotation inputs stay visible and collapsing later details preserves a canonical length", async () => {
  await page.goto(`${f.base}/quote`); const line = page.locator("[data-quote-line]").first();
  await expect(line.getByLabel("Length m", { exact: true })).toBeVisible();
  await expect(line.getByText("Costing and recovery for item 1", { exact: true })).toBeVisible();
  assert.equal(await line.locator("details").last().getAttribute("open"), null);
  await page.getByPlaceholder("Select customer", { exact: true }).click(); await page.getByRole("button", { name: /Mira Aluminium Window Systems/ }).click();
  await line.getByRole("textbox", { name: "Search aluminium profile by code or name", exact: true }).fill("AL-101"); await line.getByRole("button", { name: /AL-101/ }).first().click();
  await line.getByLabel("Qty pcs", { exact: true }).fill("100"); await line.getByLabel("Length unit", { exact: true }).selectOption("ft"); await line.getByLabel("Length ft", { exact: true }).fill("20");
  await expect(line.getByText("Saved as 6.096 m.", { exact: false })).toBeVisible();
  for (const unit of ["mm", "in", "m", "ft"]) await line.getByLabel("Length unit", { exact: true }).selectOption(unit);
  await expect(line.getByLabel("Length ft", { exact: true })).toHaveValue("20");
  await page.getByText("Delivery and payment details", { exact: true }).click(); await page.getByLabel("Delivery timeline", { exact: true }).fill("Review against dispatch plan"); await page.getByText("Delivery and payment details", { exact: true }).click();
  await page.getByRole("button", { name: "Save quote", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.entryFixture.posts.length)).toBe(1);
  const saved = await page.evaluate(() => window.entryFixture.posts[0]); assert.equal(saved.input.items[0].length_per_piece_m, 6.096); assert.equal(saved.input.delivery_timeline, "Review against dispatch plan");
});
test("actual source styles retain routine, owner and discussion controls inside a 375px phone", async () => {
  await f.seed(); await page.setViewportSize({ width: 375, height: 812 });
  for (const route of ["/discussion", "/tasks/procedures/new", `/tasks/procedures/${id(1000)}`, `/tasks/routines/${id(2000)}`, "/quote"]) {
    await page.goto(f.base + route); await expect(page.locator("#app")).not.toBeEmpty();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
