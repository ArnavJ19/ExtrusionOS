import assert from "node:assert/strict";
import test from "node:test";
import { expect } from "@playwright/test";
import { allocationBillet as billet, allocationRequirement as requirement, allocationId as id, allocationContext, createBilletAllocationBrowserFixture } from "../scripts/lib/billet-allocation-browser-fixture.mjs";
import { createManualBilletAllocationFixture, manualBilletIds as sqlIds } from "../scripts/lib/manual-billet-allocation-fixture.mjs";
import { createManualBilletActionFixture } from "../scripts/lib/manual-billet-action-fixture.mjs";

let fixture;
test.before(async () => { fixture = await createBilletAllocationBrowserFixture(); fixture.page.setDefaultTimeout(2000); });
test.after(async () => { await fixture?.close(); });
const allocate = () => fixture.page.getByRole("button", { name: "Allocate Billet", exact: true });
const refresh = () => fixture.page.getByRole("button", { name: /Refresh allocation options|Retry loading allocation/ });
const assertClean = () => assert.deepEqual(fixture.errors, []);

test("allocation panel exposes initial loading and a recoverable billet read error", async () => {
  await fixture.open();
  await expect(fixture.page.getByRole("status")).toContainText("Loading billet allocation");
  await fixture.read(0, { data: null, error: { message: "Synthetic billet read failure" } });
  await expect(fixture.page.getByRole("alert")).toContainText("Synthetic billet read failure");
  await expect(refresh()).toBeEnabled(); assertClean();
});

test("successful allocation refreshes and leaves the panel usable", async () => {
  await fixture.open(); await fixture.ready(); await fixture.selectOrder(); await allocate().click();
  await fixture.save(0, { success: true, requirementId: id(4) });
  await fixture.ready({ billet: billet({ status: "allocated", order_id: id(5) }), requirements: [], start: 2 });
  await expect(fixture.page.getByRole("heading", { name: "Manual Order Allocation" })).toBeVisible();
  await expect(fixture.page.getByText(/No open order currently/)).toBeVisible();
  await expect(fixture.page.getByRole("link", { name: "View allocated order" })).toHaveAttribute("href", `/orders/${id(5)}`);
  await expect(refresh()).toBeEnabled(); assertClean();
});

test("a failed post-save refresh preserves the confirmed allocation and can be retried", async () => {
  await fixture.open(); await fixture.ready(); await fixture.selectOrder(); await allocate().click();
  await fixture.save(0, { success: true, requirementId: id(4) });
  await fixture.read(2, { data: null, error: { message: "Synthetic refresh unavailable" } });
  await expect(fixture.page.getByRole("alert")).toContainText("Synthetic refresh unavailable");
  await expect(fixture.page.getByText(/Billet allocated to order/)).toBeVisible();
  await refresh().click(); await fixture.ready({ billet: billet({ status: "allocated", order_id: id(5) }), requirements: [], start: 3 });
  await expect(refresh()).toBeEnabled(); assertClean();
});

test("requirement errors stay unavailable instead of becoming an empty order list", async () => {
  await fixture.open(); await fixture.read(0, { data: billet(), error: null });
  await fixture.read(1, { data: null, error: { message: "Synthetic requirements unavailable" } });
  await expect(fixture.page.getByRole("alert")).toContainText("Synthetic requirements unavailable");
  assert.equal(await fixture.page.getByText(/No open order currently/).count(), 0);
  await refresh().click(); await fixture.ready({ start: 2 }); await expect(allocate()).toBeDisabled(); assertClean();
});

test("an older billet response cannot overwrite the new billet", async () => {
  await fixture.open(); await fixture.page.evaluate(value => window.__allocation.setBilletId(value), id(6));
  await fixture.ready({ start: 1, billet: billet({ id: id(6), billet_code: "BILLET-B" }), requirements: [requirement({ id: id(7), order_id: id(8), orders: { order_number: "ORDER-B" } })] });
  await fixture.read(0, { data: billet(), error: null });
  await expect(fixture.page.getByText("BILLET-B", { exact: true })).toBeVisible();
  assert.equal(await fixture.page.getByText("BILLET-A", { exact: true }).count(), 0); assertClean();
});

test("an older requirement response cannot replace current order options", async () => {
  await fixture.open(); await fixture.read(0, { data: billet(), error: null });
  await fixture.page.waitForFunction(() => window.__allocation.reads.length === 2);
  await fixture.page.evaluate(value => window.__allocation.setBilletId(value), id(6));
  await fixture.ready({ start: 2, billet: billet({ id: id(6), billet_code: "BILLET-B" }), requirements: [requirement({ id: id(7), order_id: id(8), orders: { order_number: "ORDER-B" } })] });
  await fixture.read(1, { data: [requirement()], error: null });
  await fixture.selectOrder("ORDER-B"); await allocate().click();
  assert.deepEqual(await fixture.page.evaluate(() => window.__allocation.saves[0].input), { billet_id: id(6), order_id: id(8) }); assertClean();
});

test("changing company for the same billet clears old choices and reloads in the new scope", async () => {
  await fixture.open(); await fixture.ready(); await fixture.selectOrder();
  const context = { ...allocationContext, companyId: id(20) };
  await fixture.page.evaluate(context => window.__allocation.setContext(context), context);
  await fixture.ready({ start: 2, billet: billet({ company_id: id(20) }), requirements: [] });
  assert.equal(await allocate().count(), 0);
  const calls = await fixture.page.evaluate(() => window.__allocation.reads.slice(2).map(({ filters, name, args }) => ({ filters, name, args })));
  assert.ok(calls[0].filters.some(([kind, field, value]) => kind === "eq" && field === "company_id" && value === id(20)));
  assert.equal(calls[1].name, "get_manual_billet_allocation_options"); assert.deepEqual(Object.keys(calls[1].args).sort(), ["p_billet_id", "p_page", "p_search"]); assertClean();
});

test("changing billet discards the prior order selection", async () => {
  await fixture.open(); await fixture.ready(); await fixture.selectOrder();
  await fixture.page.evaluate(value => window.__allocation.setBilletId(value), id(6));
  await fixture.ready({ start: 2, billet: billet({ id: id(6), billet_code: "BILLET-B" }) });
  await expect(allocate()).toBeDisabled(); await expect(fixture.page.getByPlaceholder("Select order")).toHaveValue(""); assertClean();
});

test("a rejected action reports uncertainty, clears saving and requires a fresh read", async () => {
  await fixture.open(); await fixture.ready(); await fixture.selectOrder(); await allocate().click();
  await fixture.save(0, "Synthetic lost confirmation", { reject: true });
  await expect(fixture.page.getByRole("alert")).toContainText(/could not be confirmed/i);
  await expect(refresh()).toBeEnabled(); await expect(allocate()).toBeDisabled();
  await refresh().click(); await fixture.ready({ start: 2 }); await fixture.selectOrder(); await expect(allocate()).toBeEnabled(); assertClean();
});

test("a failed action cannot be resubmitted from stale readiness", async () => {
  await fixture.open(); await fixture.ready(); await fixture.selectOrder(); await allocate().click();
  await fixture.save(0, { success: false, error: "Synthetic capacity changed" });
  await expect(fixture.page.getByRole("alert")).toContainText("Synthetic capacity changed");
  await expect(allocate()).toBeDisabled(); await expect(refresh()).toBeEnabled(); assertClean();
});

test("a malformed success response cannot report a confirmed allocation", async () => {
  await fixture.open(); await fixture.ready(); await fixture.selectOrder(); await allocate().click();
  await fixture.save(0, { success: true });
  await expect(fixture.page.getByRole("alert")).toContainText(/could not be confirmed/i);
  assert.equal((await fixture.page.evaluate(() => window.__allocation.notices)).filter(row => row.kind === "success").length, 0); assertClean();
});

test("same-event duplicate clicks send one write and pending controls remain disabled", async () => {
  await fixture.open(); await fixture.ready(); await fixture.selectOrder();
  await allocate().evaluate(button => { button.click(); button.click(); });
  await expect(fixture.page.getByRole("button", { name: "Saving...", exact: true })).toBeDisabled();
  assert.equal(await fixture.page.evaluate(() => window.__allocation.saves.length), 1);
  await expect(fixture.page.getByPlaceholder("Select order")).toBeDisabled(); await expect(refresh()).toBeDisabled(); assertClean();
});

test("a late save after switching billets cannot clear or refresh the new panel", async () => {
  await fixture.open(); await fixture.ready(); await fixture.selectOrder(); await allocate().click();
  await fixture.page.evaluate(value => window.__allocation.setBilletId(value), id(6));
  await fixture.ready({ start: 2, billet: billet({ id: id(6), billet_code: "BILLET-B" }) }); await fixture.selectOrder();
  await fixture.save(0, { success: true, requirementId: id(4) });
  await expect(fixture.page.getByText("BILLET-B", { exact: true })).toBeVisible();
  await expect(allocate()).toBeEnabled(); assert.equal(await fixture.page.evaluate(() => window.__allocation.reads.length), 4);
  assert.deepEqual(await fixture.page.evaluate(() => window.__allocation.notices), []); assertClean();
});

test("unmounted load and save completions are ignored", async () => {
  await fixture.open(); await fixture.page.evaluate(() => window.__allocation.setMounted(false));
  await fixture.read(0, { data: null, error: { message: "Obsolete error" } });
  assert.deepEqual(await fixture.page.evaluate(() => window.__allocation.notices), []);
  await fixture.open(); await fixture.ready(); await fixture.selectOrder(); await allocate().click();
  await fixture.page.evaluate(() => window.__allocation.setMounted(false)); await fixture.save(0, { success: true, requirementId: id(4) });
  await expect(fixture.page.getByText("Panel unmounted")).toBeVisible();
  assert.deepEqual(await fixture.page.evaluate(() => window.__allocation.notices), []); assertClean();
});

test("a rejected read offers retry without an unhandled rejection", async () => {
  await fixture.open(); await fixture.read(0, "Synthetic connection refused", { reject: true });
  await expect(fixture.page.getByRole("alert")).toContainText("Synthetic connection refused"); await expect(refresh()).toBeEnabled(); assertClean();
});

for (const [name, data] of [["missing billet", null], ["another billet", billet({ id: id(99) })], ["another company", billet({ company_id: id(99) })], ["invalid allocated order", billet({ order_id: "invalid" })]]) {
  test(`invalid ${name} response cannot expose allocation controls`, async () => {
    await fixture.open(); await fixture.read(0, { data, error: null });
    await expect(fixture.page.getByRole("alert")).toBeVisible(); assert.equal(await allocate().count(), 0); assertClean();
  });
}

test("a missing requirement payload is unavailable instead of verified empty", async () => {
  await fixture.open(); await fixture.read(0, { data: billet(), error: null }); await fixture.read(1, { data: null, error: null });
  await expect(fixture.page.getByRole("alert")).toBeVisible(); assert.equal(await fixture.page.getByText(/No open order currently/).count(), 0); assertClean();
});

test("non-allocatable billets retain their status and do not query requirements", async () => {
  for (const row of [billet({ status: "consumed" }), billet({ status: "allocated", production_job_id: id(30) })]) {
    await fixture.open(); await fixture.ready({ billet: row });
    await expect(fixture.page.getByText(/This billet is not available for manual allocation/)).toBeVisible();
    assert.equal(await fixture.page.evaluate(() => window.__allocation.reads.length), 1); assertClean();
  }
});

test("the browser's allocation reaches the actual action and SQL, then refreshes persisted quantities", async () => {
  const sql = await createManualBilletAllocationFixture();
  try {
    await sql.reset(); await sql.insertBillet({ temper: "T6" }); const actions = createManualBilletActionFixture(sql);
    await fixture.open(); await fixture.page.evaluate(({ context, billetId }) => {
      window.__allocation.setContext(context); window.__allocation.setBilletId(billetId);
    }, { context: { companyId: sqlIds.company, userId: sqlIds.actor, role: "owner", dealerId: null }, billetId: sqlIds.freeBillet });
    const row = await sql.billet(), rows = (await sql.requirements()).filter(req => req.temper === "T6");
    const options = rows.map(req => ({ ...req, orders: { order_number: "SQL-ORDER", priority: "normal" } }));
    await fixture.ready({ start: 1, billet: row, requirements: options }); await fixture.selectOrder("SQL-ORDER"); await allocate().click();
    const input = await fixture.page.evaluate(() => window.__allocation.saves[0].input);
    assert.deepEqual(input, { billet_id: sqlIds.freeBillet, order_id: sql.orderId });
    const result = await actions.allocate(input); assert.equal(result.success, true); await fixture.save(0, result);
    const retained = await sql.billet(); assert.equal(retained.order_id, sql.orderId); assert.equal(retained.status, "allocated");
    await fixture.ready({ start: 3, billet: retained, requirements: [] }); await expect(refresh()).toBeEnabled();
    const snapshot = await sql.snapshot(); await refresh().click(); await fixture.ready({ start: 5, billet: retained, requirements: [] });
    assert.deepEqual(await sql.snapshot(), snapshot); assert.equal(actions.state.calls.length, 1); assertClean();
  } finally { await sql.close(); }
});

test("an obsolete requirement failure cannot replace a newer ready panel", async () => {
  await fixture.open(); await fixture.read(0, { data: billet(), error: null });
  await fixture.page.waitForFunction(() => window.__allocation.reads.length === 2);
  await fixture.page.evaluate(value => window.__allocation.setBilletId(value), id(6));
  await fixture.ready({ start: 2, billet: billet({ id: id(6), billet_code: "BILLET-B" }) });
  await fixture.read(1, "Obsolete connection failure", { reject: true });
  await expect(fixture.page.getByText("BILLET-B", { exact: true })).toBeVisible();
  assert.equal(await fixture.page.getByRole("alert").count(), 0); assertClean();
});

test("manual refresh clears selection and disables writes until the new read completes", async () => {
  await fixture.open(); await fixture.ready(); await fixture.selectOrder(); await refresh().click();
  await expect(fixture.page.getByRole("status")).toContainText("Loading billet allocation");
  assert.equal(await allocate().count(), 0); await expect(refresh()).toBeDisabled();
  await fixture.ready({ start: 2 }); await expect(allocate()).toBeDisabled();
  await expect(fixture.page.getByPlaceholder("Select order")).toHaveValue(""); assertClean();
});

test("a changed user or role resets same-company readiness", async () => {
  for (const context of [{ ...allocationContext, userId: id(50) }, { ...allocationContext, role: "admin" }]) {
    await fixture.open(); await fixture.ready(); await fixture.selectOrder();
    await fixture.page.evaluate(context => window.__allocation.setContext(context), context);
    await fixture.ready({ start: 2 }); await expect(allocate()).toBeDisabled(); assertClean();
  }
});

for (const [name, row] of [["null row", null], ["foreign company", requirement({ company_id: id(99) })], ["invalid order", requirement({ order_id: "invalid" })]]) {
  test(`invalid requirement ${name} cannot become an allocation option`, async () => {
    await fixture.open(); await fixture.read(0, { data: billet(), error: null }); await fixture.read(1, { data: [row], error: null });
    await expect(fixture.page.getByRole("alert")).toContainText("could not be verified");
    assert.equal(await allocate().count(), 0); assertClean();
  });
}

test("browser reallocation preserves physical billet data and updates both order counters", async () => {
  const sql = await createManualBilletAllocationFixture();
  try {
    await sql.reset(); await sql.seedAllocation(); const actions = createManualBilletActionFixture(sql), before = await sql.billet(sqlIds.legacyBillet);
    const sourceBefore = await sql.requirements(sql.sourceOrderId), targetBefore = await sql.requirements();
    await fixture.open(); await fixture.page.evaluate(({ context, billetId }) => {
      window.__allocation.setContext(context); window.__allocation.setBilletId(billetId);
    }, { context: { companyId: sqlIds.company, userId: sqlIds.actor, role: "owner", dealerId: null }, billetId: sqlIds.legacyBillet });
    const options = targetBefore.filter(req => req.temper === "T6").map(req => ({ ...req, orders: { order_number: "SQL-ORDER" } }));
    await fixture.ready({ start: 1, billet: before, requirements: options }); await fixture.selectOrder("SQL-ORDER");
    await fixture.page.getByRole("button", { name: "Reallocate Billet", exact: true }).click();
    const call = await fixture.page.evaluate(() => ({ name: window.__allocation.saves[0].name, input: window.__allocation.saves[0].input }));
    assert.equal(call.name, "reallocate"); const result = await actions.reallocate(call.input); assert.equal(result.success, true);
    await fixture.save(0, result); const after = await sql.billet(sqlIds.legacyBillet);
    for (const field of ["weight_kg", "billet_length_mm", "billet_diameter_inch", "billet_diameter_mm", "alloy", "temper", "source_type", "foundry_batch_id", "production_job_id"]) {
      assert.ok(Object.hasOwn(after, field), `The physical field ${field} must exist in the fixture`);
      assert.deepEqual(after[field], before[field], field);
    }
    assert.equal(after.order_id, sql.orderId);
    assert.equal((await sql.requirements(sql.sourceOrderId)).reduce((sum, row) => sum + row.billets_allocated, 0), sourceBefore.reduce((sum, row) => sum + row.billets_allocated, 0) - 1);
    assert.equal((await sql.requirements()).reduce((sum, row) => sum + row.billets_allocated, 0), targetBefore.reduce((sum, row) => sum + row.billets_allocated, 0) + 1);
    await fixture.ready({ start: 3, billet: after, requirements: [] }); await expect(refresh()).toBeEnabled(); assertClean();
  } finally { await sql.close(); }
});

test("a committed SQL allocation with a lost confirmation requires review and never silently posts twice", async () => {
  const sql = await createManualBilletAllocationFixture();
  try {
    await sql.reset(); await sql.insertBillet({ temper: "T6" }); const actions = createManualBilletActionFixture(sql); actions.state.throwAfterWrite = true;
    await fixture.open(); await fixture.page.evaluate(({ context, billetId }) => {
      window.__allocation.setContext(context); window.__allocation.setBilletId(billetId);
    }, { context: { companyId: sqlIds.company, userId: sqlIds.actor, role: "owner", dealerId: null }, billetId: sqlIds.freeBillet });
    const options = (await sql.requirements()).filter(req => req.temper === "T6").map(req => ({ ...req, orders: { order_number: "SQL-ORDER" } }));
    await fixture.ready({ start: 1, billet: await sql.billet(), requirements: options }); await fixture.selectOrder("SQL-ORDER"); await allocate().click();
    const input = await fixture.page.evaluate(() => window.__allocation.saves[0].input), result = await actions.allocate(input);
    assert.equal(result.success, false); assert.equal((await sql.billet()).order_id, sql.orderId); await fixture.save(0, result);
    await expect(fixture.page.getByRole("alert")).toContainText(/Refresh the billet/); await expect(allocate()).toBeDisabled();
    const retained = await sql.snapshot(); await refresh().click(); await fixture.ready({ start: 3, billet: await sql.billet(), requirements: [] });
    await expect(fixture.page.getByRole("link", { name: "View allocated order" })).toHaveAttribute("href", `/orders/${sql.orderId}`);
    assert.deepEqual(await sql.snapshot(), retained); assert.equal(actions.state.calls.length, 1); assert.equal(await allocate().count(), 0); assertClean();
  } finally { await sql.close(); }
});
