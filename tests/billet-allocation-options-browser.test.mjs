import assert from "node:assert/strict";
import test from "node:test";
import { expect } from "@playwright/test";
import { allocationBillet, createBilletAllocationBrowserFixture } from "../scripts/lib/billet-allocation-browser-fixture.mjs";
import { allocationOptionIds as f, createAllocationOptionsFixture, mountSqlAllocation, answerSqlAllocationReads } from "../scripts/lib/billet-allocation-options-fixture.mjs";

let browser, sql;
test.before(async () => { browser = await createBilletAllocationBrowserFixture(); sql = await createAllocationOptionsFixture(); });
test.after(async () => { await browser?.close(); await sql?.close(); });
const selection = () => browser.page.getByPlaceholder("Select order");

test("the lookup does not offer an order that the actual writer rejects for temper", async () => {
  await sql.reset(); await sql.insertBillet({ temper: "T4" }); const before = await sql.snapshot();
  await assert.rejects(sql.allocate(), /compatible/); assert.deepEqual(await sql.snapshot(), before);
  await mountSqlAllocation(browser, sql); assert.equal(await selection().count(), 0);
  await expect(browser.page.getByText(/No .*order|No matching/)).toBeVisible(); assert.deepEqual(browser.errors, []);
});

test("normalized alloy and temper accepted by the writer remain discoverable", async () => {
  await sql.reset(); await sql.insertBillet({ temper: " t6 " });
  await sql.db.query("update foundry_billets set alloy=' 6063 ' where id=$1", [f.freeBillet]);
  await mountSqlAllocation(browser, sql); await expect(selection()).toBeVisible();
  await selection().click(); await expect(browser.page.getByRole("button", { name: new RegExp(`^${(await sql.db.query('select order_number from orders where id=$1', [sql.orderId])).rows[0].order_number}`) })).toBeVisible();
  await sql.allocate(); assert.equal((await sql.billet()).order_id, sql.orderId); assert.deepEqual(browser.errors, []);
});

test("delivered and payment-pending orders do not appear as compatible open orders", async () => {
  for (const stage of ["delivered", "payment_pending"]) {
    await sql.reset(); await sql.stage(stage); await sql.stage(stage, sql.sourceOrderId); await sql.insertBillet({ temper: "T6" });
    await mountSqlAllocation(browser, sql); assert.equal(await selection().count(), 0, stage); assert.deepEqual(browser.errors, []);
  }
});

test("fully covered dispatched profiles do not remain allocation choices", async () => {
  await sql.reset();
  for (const order of [sql.orderId, sql.sourceOrderId]) {
    await sql.seedJob({ order, profile: f.t5Profile, status: "completed" }); await sql.seedJob({ order, profile: f.t6Profile, status: "completed" }); await sql.stage("dispatched", order);
  }
  await sql.insertBillet({ temper: "T6" }); await mountSqlAllocation(browser, sql); assert.equal(await selection().count(), 0); assert.deepEqual(browser.errors, []);
});

test("two matching requirements produce one distinct choice per order", async () => {
  await sql.reset({ secondTemper: "T6" }); await sql.insertBillet({ temper: "T6" });
  await mountSqlAllocation(browser, sql); await selection().click();
  const order = (await sql.db.query("select order_number from orders where id=$1", [sql.orderId])).rows[0].order_number;
  assert.equal(await browser.page.getByRole("button", { name: new RegExp(`^${order} -`) }).count(), 1); assert.deepEqual(browser.errors, []);
});

test("a small REST row cap cannot hide a later compatible order", async () => {
  await sql.reset(); await sql.insertBillet({ temper: "T6" });
  await sql.db.query("update order_billet_requirements set created_at=case when order_id=$1 then timestamp '2000-01-01' else timestamp '2001-01-01' end", [sql.sourceOrderId]);
  await mountSqlAllocation(browser, sql, { cap: 1 }); await selection().click();
  const order = (await sql.db.query("select order_number from orders where id=$1", [sql.orderId])).rows[0].order_number;
  await expect(browser.page.getByRole("button", { name: new RegExp(`^${order} -`) })).toBeVisible(); assert.deepEqual(browser.errors, []);
});

test("ten-row pages reach later orders and clear the prior order selection", async () => {
  await sql.reset(); for (let index = 0; index < 11; index++) await sql.createOrder(); await sql.insertBillet({ temper: "T6" });
  await mountSqlAllocation(browser, sql); await selection().click();
  await browser.page.getByRole("button", { name: /^O-.* -/ }).first().click();
  await browser.page.getByRole("button", { name: "Next orders", exact: true }).click(); await answerSqlAllocationReads(browser, sql, 3);
  assert.match(await browser.page.locator("body").innerText(), /Page 2 of 2 \/ 13 compatible orders/);
  await expect(selection()).toHaveValue(""); await expect(browser.page.getByRole("button", { name: "Allocate Billet", exact: true })).toBeDisabled();
  await selection().click(); assert.equal(await browser.page.getByRole("button", { name: /^O-.* -/ }).count(), 3);
  await browser.page.getByRole("button", { name: "Previous orders", exact: true }).click(); await answerSqlAllocationReads(browser, sql, 5);
  assert.match(await browser.page.locator("body").innerText(), /Page 1 of 2 \/ 13 compatible orders/); assert.deepEqual(browser.errors, []);
});

test("global search reaches orders outside the first page and treats percent literally", async () => {
  await sql.reset(); let last;
  for (let index = 0; index < 11; index++) last = await sql.createOrder();
  await sql.insertBillet({ temper: "T6" });
  const number = (await sql.db.query("select order_number from orders where id=$1", [last])).rows[0].order_number;
  await mountSqlAllocation(browser, sql); await browser.page.getByLabel("Find compatible orders", { exact: true }).fill(number); await answerSqlAllocationReads(browser, sql, 3);
  await expect(browser.page.getByText("Page 1 of 1 / 1 compatible orders", { exact: true })).toBeVisible(); await selection().click();
  await expect(browser.page.getByRole("button", { name: new RegExp(`^${number} -`) })).toBeVisible();
  await browser.page.getByLabel("Find compatible orders", { exact: true }).fill("%"); await answerSqlAllocationReads(browser, sql, 5);
  assert.equal(await selection().count(), 0); await expect(browser.page.getByText(/No matching compatible order/)).toBeVisible();
  await browser.page.getByLabel("Find compatible orders", { exact: true }).fill(""); await answerSqlAllocationReads(browser, sql, 7);
  assert.match(await browser.page.locator("body").innerText(), /Page 1 of 2 \/ 13 compatible orders/); assert.deepEqual(browser.errors, []);
});

for (const failure of [false, true]) test(`a stale search ${failure ? "failure" : "response"} cannot replace current options`, async () => {
  await sql.reset(); await sql.insertBillet({ temper: "T6" });
  const numbers = (await sql.db.query("select order_number from orders order by order_number")).rows.map(row => row.order_number);
  await mountSqlAllocation(browser, sql); await browser.page.getByLabel("Find compatible orders", { exact: true }).fill(numbers[0]);
  await browser.page.waitForFunction(() => window.__allocation.reads[3]);
  const first = await browser.page.evaluate(() => { const { table, columns, filters } = window.__allocation.reads[3]; return { table, columns, filters }; });
  await browser.read(3, await sql.browserRead(first)); await browser.page.waitForFunction(() => window.__allocation.reads[4]);
  const old = await browser.page.evaluate(() => { const { kind, name, args } = window.__allocation.reads[4]; return { kind, name, args }; });
  await browser.page.getByLabel("Find compatible orders", { exact: true }).fill(numbers[1]); await answerSqlAllocationReads(browser, sql, 5);
  await selection().click(); await browser.page.getByRole("button", { name: new RegExp(`^${numbers[1]} -`) }).click();
  await browser.read(4, failure ? "Obsolete allocation read failed" : await sql.browserRead(old), { reject: failure });
  await expect(selection()).toHaveValue(new RegExp(`^${numbers[1]}`));
  await expect(browser.page.getByRole("button", { name: "Allocate Billet", exact: true })).toBeEnabled(); assert.equal(await browser.page.getByRole("alert").count(), 0); assert.deepEqual(browser.errors, []);
});

test("a missing new RPC is explicitly unavailable and never falls back to capped requirements", async () => {
  await browser.open(); await browser.read(0, { data: allocationBillet(), error: null });
  await browser.read(1, { data: null, error: { code: "PGRST202", message: "Could not find private implementation detail" } });
  await expect(browser.page.getByRole("alert")).toContainText("database update is ready"); assert.equal(await selection().count(), 0);
  assert.equal(await browser.page.evaluate(() => window.__allocation.reads.some(row => row.table === "order_billet_requirements")), false); assert.deepEqual(browser.errors, []);
});

test("the read snapshot replaces a billet issued between the header and options requests", async () => {
  await sql.reset(); await sql.insertBillet({ temper: "T6" }); await browser.open();
  await browser.page.evaluate(f => { window.__allocation.setContext({ companyId: f.company, userId: f.actor, role: "owner", dealerId: null }); window.__allocation.setBilletId(f.freeBillet); }, f);
  await browser.page.waitForFunction(() => window.__allocation.reads[1]);
  const call = await browser.page.evaluate(() => { const { table, columns, filters } = window.__allocation.reads[1]; return { table, columns, filters }; });
  await browser.read(1, await sql.browserRead(call)); await browser.page.waitForFunction(() => window.__allocation.reads[2]);
  await sql.db.query("update foundry_billets set status='consumed' where id=$1", [f.freeBillet]);
  const rpc = await browser.page.evaluate(() => { const { kind, name, args } = window.__allocation.reads[2]; return { kind, name, args }; });
  await browser.read(2, await sql.browserRead(rpc)); await expect(browser.page.getByText(/This billet is not available for manual allocation/)).toBeVisible();
  assert.equal(await selection().count(), 0); assert.deepEqual(browser.errors, []);
});

test("a role outside manual allocation cannot retain a mounted mutation panel", async () => {
  await sql.reset(); await sql.insertBillet({ temper: "T6" }); await mountSqlAllocation(browser, sql);
  await browser.page.evaluate(f => window.__allocation.setContext({ companyId: f.company, userId: f.actor, role: "viewer", dealerId: null }), f);
  await expect(browser.page.getByRole("heading", { name: "Manual Order Allocation" })).toHaveCount(0);
  assert.equal(await browser.page.evaluate(() => window.__allocation.reads.length), 3); assert.deepEqual(browser.errors, []);
});

for (const patch of [{ billet_code: {} }, { temper: {} }, { billet_diameter_inch: "6" }]) test(`malformed initial billet field ${Object.keys(patch)[0]} is unavailable before lookup`, async () => {
  await browser.open(); await browser.read(0, { data: allocationBillet({ ...patch, status: "consumed" }), error: null });
  await expect(browser.page.getByRole("alert")).toContainText("Billet details could not be verified");
  assert.equal(await browser.page.evaluate(() => window.__allocation.reads.length), 1); assert.deepEqual(browser.errors, []);
});
