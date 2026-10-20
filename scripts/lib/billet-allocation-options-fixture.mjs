import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createManualBilletAllocationFixture, manualBilletIds } from "./manual-billet-allocation-fixture.mjs";

export { manualBilletIds as allocationOptionIds };
export const allocationOptionsMigration = "20261020070000_manual_billet_allocation_options.sql";

export async function createAllocationOptionsFixture({ candidate = existsSync(new URL(`../../supabase/migrations/${allocationOptionsMigration}`, import.meta.url)) } = {}) {
  const sql = await createManualBilletAllocationFixture();
  try {
    if (candidate) await sql.db.exec(readFileSync(new URL(`../../supabase/migrations/${allocationOptionsMigration}`, import.meta.url), "utf8"));
    return { ...sql, get orderId() { return sql.orderId; }, get sourceOrderId() { return sql.sourceOrderId; },
      options: (billetId = manualBilletIds.freeBillet, search = "", page = 1) => sql.asAuthenticated(() => sql.db.query(
        "select public.get_manual_billet_allocation_options($1,$2,$3) result", [billetId, search, page])),
      async browserRead(call, cap = 1000) {
        if (call.kind === "rpc") {
          assert.equal(call.name, "get_manual_billet_allocation_options");
          const args = call.args;
          return { data: (await sql.asAuthenticated(() => sql.db.query("select public.get_manual_billet_allocation_options($1,$2,$3) result", [args.p_billet_id, args.p_search, args.p_page]))).rows[0].result, error: null };
        }
        const value = (kind, key) => call.filters.find(row => row[0] === kind && row[1] === key)?.[2];
        assert.ok(value("eq", "company_id"), "Historical browser reads require the captured company filter");
        if (call.table === "foundry_billets") {
          const columns = call.columns.split(",").map(column => column.trim());
          assert.ok(columns.every(column => ["id", "company_id", "billet_code", "alloy", "temper", "billet_diameter_inch", "status", "order_id", "production_job_id"].includes(column)));
          return { data: (await sql.db.query(`select to_jsonb(header) result from (select ${columns.join(",")} from foundry_billets where company_id=$1 and id=$2) header`, [value("eq", "company_id"), value("eq", "id")])).rows[0]?.result ?? null, error: null };
        }
        assert.equal(call.table, "order_billet_requirements");
        const rows = (await sql.db.query(`select r.id,r.company_id,r.order_id,r.alloy,r.billet_diameter_inch,r.billets_required,r.billets_allocated,r.billets_short,r.status,
          jsonb_build_object('order_number',o.order_number,'priority',o.priority,'current_stage',o.current_stage) orders
          from order_billet_requirements r join orders o on o.id=r.order_id and o.company_id=r.company_id
          where r.company_id=$1 and r.alloy ilike $2 and r.billet_diameter_inch=$3 and r.status=any($4::text[]) and r.billets_short>$5
          order by r.created_at limit $6`, [value("eq", "company_id"), value("ilike", "alloy"), value("eq", "billet_diameter_inch"), value("in", "status"), value("gt", "billets_short"), cap])).rows;
        return { data: rows, error: null };
      },
    };
  } catch (error) { await sql.close(); throw error; }
}

export async function mountSqlAllocation(browser, sql, { cap = 1000 } = {}) {
  await browser.open();
  await browser.page.evaluate(({ company, actor, billet }) => {
    window.__allocation.setContext({ companyId: company, userId: actor, role: "owner", dealerId: null });
    window.__allocation.setBilletId(billet);
  }, { ...manualBilletIds, billet: manualBilletIds.freeBillet });
  await browser.page.waitForFunction(() => window.__allocation.reads.length >= 2);
  await answerSqlAllocationReads(browser, sql, 1, cap);
}

export async function answerSqlAllocationReads(browser, sql, start, cap = 1000) {
  for (const index of [start, start + 1]) {
    await browser.page.waitForFunction(index => Boolean(window.__allocation.reads[index]), index);
    const call = await browser.page.evaluate(index => {
      const { table, columns, filters, kind, name, args } = window.__allocation.reads[index];
      return { table, columns, filters, kind, name, args };
    }, index);
    await browser.read(index, await sql.browserRead(call, cap));
  }
  await browser.page.waitForFunction(() => !document.body.innerText.includes("Loading billet allocation"));
}
