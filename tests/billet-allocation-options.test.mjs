import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync, mkdirSync } from "node:fs";
import { allocationOptionIds as f, createAllocationOptionsFixture } from "../scripts/lib/billet-allocation-options-fixture.mjs";

test("manual allocation options preserve writer eligibility and complete read boundaries", async context => {
  const progressRoot = new URL("../test-results/billet-allocation-options/", import.meta.url);
  mkdirSync(progressRoot, { recursive: true });
  const progress = new URL(`sql-progress-${process.pid}.log`, progressRoot);
  context.beforeEach(child => appendFileSync(progress, `START ${child.name}\n`));
  context.afterEach(child => appendFileSync(progress, `END ${child.name}\n`));
  const sql = await createAllocationOptionsFixture(), { db } = sql;
  const read = async (...args) => (await sql.options(...args)).rows[0].result;
  const seed = async options => { await sql.reset(options); await sql.insertBillet({ temper: "T6" }); };
  try {
    await context.test("reads distinct compatible orders without changing stock, requirements or notices", async () => {
      await seed(); const before = await sql.snapshot(), result = await read();
      assert.equal(result.company_id, f.company); assert.equal(result.billet.id, f.freeBillet); assert.equal(result.billet.temper, "T6");
      assert.equal(result.total_count, 2); assert.equal(result.page_size, 10); assert.equal(result.items.length, 2);
      assert.ok(result.items.every(row => row.requirement_count === 1)); assert.deepEqual(await sql.snapshot(), before);
    });
    await context.test("same-material profiles are grouped once per order with exact summed counts", async () => {
      await seed({ secondTemper: "T6" }); const result = await read(), target = result.items.find(row => row.order_id === sql.orderId);
      assert.equal(result.total_count, 2); assert.equal(target.requirement_count, 2); assert.equal(target.billets_short, 2); assert.equal(target.billets_required, 2);
      assert.equal(new Set(result.items.map(row => row.order_id)).size, 2);
    });
    for (const role of ["owner", "admin", "factory_manager", "production_manager", "production"]) await context.test(`${role} can read the exact scoped allocation projection`, async () => {
      await seed(); await db.query("update app_users set role=$1 where id=$2", [role, f.actor]); const result = await read(); assert.equal(result.total_count, 2);
    });
    for (const role of ["sales", "accounts", "quality", "inventory_manager", "dispatch", "viewer", "dealer_admin", null]) await context.test(`${role ?? "missing role"} cannot read allocation choices`, async () => {
      await seed(); await db.query("update app_users set role=$1 where id=$2", [role, f.actor]); await assert.rejects(read(), /permission/);
    });
    await context.test("inactive and missing identities cannot read the projection", async () => {
      await seed(); await db.query("update app_users set is_active=false where id=$1", [f.actor]); await assert.rejects(read(), /Authentication/);
      await db.exec("set test.actor='';"); try { await assert.rejects(read(), /Authentication/); } finally { await db.query("select set_config('test.actor',$1,false)", [f.actor]); }
    });
    await context.test("second-company orders and foreign or missing billet identities never leak", async () => {
      await seed(); const otherOrder = await sql.createOrder({ otherCompany: true }); const result = await read();
      assert.ok(result.items.every(row => row.company_id === f.company && row.order_id !== otherOrder));
      await db.query("select set_config('test.actor',$1,false)", [f.otherActor]);
      try { await assert.rejects(read(), /Billet not found/); } finally { await db.query("select set_config('test.actor',$1,false)", [f.actor]); }
      await assert.rejects(read(null), /Billet not found/);
    });
    for (const [label, change] of [["temper", "temper='T4'"], ["alloy", "alloy='6061'"], ["diameter", "billet_diameter_inch=8"]]) await context.test(`incompatible ${label} cannot yield a choice`, async () => {
      await seed(); await db.query(`update foundry_billets set ${change} where id=$1`, [f.freeBillet]); assert.equal((await read()).total_count, 0);
    });
    await context.test("normalization agrees with allocation instead of using an ILIKE wildcard", async () => {
      await seed(); await db.query("update foundry_billets set alloy=' 6063 ',temper=' t6 ' where id=$1", [f.freeBillet]);
      assert.equal((await read()).total_count, 2); await sql.allocate(); assert.equal((await sql.billet()).order_id, sql.orderId);
      await seed(); await db.query("update foundry_billets set alloy='606%' where id=$1", [f.freeBillet]); assert.equal((await read()).total_count, 0);
    });
    for (const stage of ["closed", "cancelled", "delivered", "payment_pending"]) await context.test(`${stage} orders are excluded even with retained positive requirements`, async () => {
      await seed(); await sql.stage(stage); await sql.stage(stage, sql.sourceOrderId); assert.equal((await read()).total_count, 0);
    });
    await context.test("dispatched profile eligibility is shared with the actual allocation authority", async () => {
      await sql.reset({ secondTemper: "T6" });
      for (const order of [sql.orderId, sql.sourceOrderId]) {
        await sql.seedJob({ order, profile: f.t5Profile, status: "completed" }); await sql.seedJob({ order, profile: f.t6Profile, status: "completed" }); await sql.stage("dispatched", order);
      }
      await sql.insertBillet({ temper: "T6" });
      assert.equal((await read()).total_count, 0);
      await sql.reset({ secondTemper: "T6" });
      await sql.seedJob({ profile: f.t5Profile, status: "completed" });
      await sql.seedJob({ profile: f.t6Profile, status: "planned" });
      await sql.stage("dispatched"); await sql.stage("delivered", sql.sourceOrderId); await sql.insertBillet({ temper: "T6" });
      const result = await read(); assert.equal(result.total_count, 1); assert.equal(result.items[0].requirement_count, 1);
      const saved = await sql.allocate(); assert.equal((await sql.requirements()).find(row => row.id === saved.rows[0].id).profile_id, f.t6Profile);
    });
    await context.test("literal search and case folding do not expand percent, underscore or backslash", async () => {
      await seed(); const order = (await db.query("select order_number from orders where id=$1", [sql.orderId])).rows[0].order_number;
      assert.deepEqual((await read(f.freeBillet, ` ${order.toLowerCase()} `)).items.map(row => row.order_id), [sql.orderId]);
      for (const query of ["%", "_", "\\", "[", "' or true --"]) assert.equal((await read(f.freeBillet, query)).total_count, 0, query);
    });
    await context.test("invalid page and oversized query input fail before returning rows", async () => {
      await seed(); for (const page of [0, -1, null]) await assert.rejects(read(f.freeBillet, "", page), /Invalid allocation/);
      await assert.rejects(read(f.freeBillet, "x".repeat(101)), /Invalid allocation/);
    });
    for (const [label, patch] of [["low allocated counter", "billets_allocated=0,billets_short=1"], ["high allocated counter", "billets_allocated=1,billets_short=0"]]) await context.test(`stale ${label} is unavailable without silently repairing history`, async () => {
      await seed(); if (label.startsWith("low")) await sql.seedAllocation({ billetId: f.legacyBillet, order: sql.orderId });
      await db.query(`update order_billet_requirements set ${patch} where order_id=$1 and profile_id=$2`, [sql.orderId, f.t6Profile]);
      const before = await sql.snapshot(); await assert.rejects(read(), /evidence needs refresh/); assert.deepEqual(await sql.snapshot(), before);
    });
    await context.test("unlinked committed legacy stock requires review without read-time repair", async () => {
      await seed(); await sql.insertBillet({ id: f.legacyBillet, status: "allocated", order: sql.orderId, temper: "T6" });
      const before = await sql.snapshot(); await assert.rejects(read(), /evidence needs refresh/); assert.deepEqual(await sql.snapshot(), before);
    });
    await context.test("a broken existing allocation cannot be advertised as reallocatable", async () => {
      await sql.reset(); await sql.insertBillet({ status: "allocated", temper: "T6" }); await assert.rejects(read(), /historical review/);
    });
    for (const status of ["issued", "consumed", "scrap"]) await context.test(`${status} billets return no manual choices`, async () => {
      await sql.reset(); await sql.insertBillet({ status, temper: "T6" }); const result = await read(); assert.equal(result.total_count, 0); assert.deepEqual(result.items, []);
    });
    await context.test("the reader's ACL, stability and private helper boundary remain narrow", async () => {
      const rights = (await db.query(`select p.prosecdef,p.provolatile,p.proconfig,
        has_function_privilege('authenticated',p.oid,'execute') authenticated,
        has_function_privilege('anon',p.oid,'execute') anonymous,
        has_function_privilege('authenticated','private.order_profile_needs_billet_allocation(uuid,uuid,uuid)','execute') private_helper
        from pg_proc p where p.oid='public.get_manual_billet_allocation_options(uuid,text,integer)'::regprocedure`)).rows[0];
      assert.deepEqual(rights, { prosecdef: true, provolatile: "s", proconfig: ["search_path=public, private"], authenticated: true, anonymous: false, private_helper: false });
      await db.exec("set role anon;"); try { await assert.rejects(sql.attempt(() => db.query("select public.get_manual_billet_allocation_options(null)")), /permission denied/); } finally { await db.exec("reset role;"); }
    });
    await context.test("more than 1,000 valid orders have complete stable ten-row pages and a clamped last page", async () => {
      await sql.reset();
      // Use the supported sales capture path; owners also trigger a complete
      // company priority allocation on each create, outside this read test.
      await db.query("update app_users set role='sales' where id=$1", [f.actor]);
      try {
        for (let index = 0; index < 1001; index++) {
          await sql.createOrder(); if (index % 100 === 0) appendFileSync(progress, `SEEDED ${index + 1}\n`);
        }
      } finally { await db.query("update app_users set role='owner' where id=$1", [f.actor]); }
      await sql.insertBillet({ temper: "T6" });
      const first = await read(), ids = []; assert.equal(first.total_count, 1003); assert.equal(first.items.length, 10);
      for (let page = 1; page <= 101; page++) {
        const result = await read(f.freeBillet, "", page); assert.equal(result.total_count, 1003); assert.equal(result.page, page); assert.ok(result.items.length <= 10); ids.push(...result.items.map(row => row.order_id));
      }
      assert.equal(ids.length, 1003); assert.equal(new Set(ids).size, 1003);
      const last = await read(f.freeBillet, "", 2147483647); assert.equal(last.page, 101); assert.equal(last.items.length, 3);
      assert.deepEqual((await read()).items, first.items);
      const snapshot = await sql.snapshot(); await db.exec("commit;begin transaction read only;");
      assert.equal((await read()).total_count, 1003); assert.deepEqual(await sql.snapshot(), snapshot);
      await db.exec("rollback;begin;");
    });
  } finally { await sql.close(); }
});
