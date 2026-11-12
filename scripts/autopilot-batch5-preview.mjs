// Real screens and gateway on a replayed local database, with synthetic operating records only.
import { createDispatchBrowserFixture } from "./lib/autopilot-batch4-browser-fixture.mjs";
import { addOperationsHelpers, ids as i, istDay } from "./lib/autopilot-batch5-operations-fixture.mjs";

process.env.DISPATCH_FIXTURE_PORT ??= "4185";
const browserFixture = await createDispatchBrowserFixture();
await browserFixture.start();
const itemId = await browserFixture.run(async () => {
  const f = addOperationsHelpers(browserFixture.f);
  const item = await f.item();
  const j = await f.plannedJob({ days: 3 });
  await f.seed("update orders set expected_dispatch_date=current_date+1 where id=$1", [j.order]);
  const draft = await f.plannedJob({ kg: 400, days: 3, firm: false });
  await f.seed("delete from order_billet_requirements where order_id=$1", [draft.order]);
  await f.seed("update order_items set finishing_type='anodizing' where id=$1", [j.line]);
  await f.seed("delete from factory_finishing_lead_times where company_id=$1", [i.company]);
  await f.seed("insert into finishing_jobs(id,company_id,order_id,production_job_id,finishing_type,sent_date,input_weight_kg,status) values($1,$2,$3,$4,'anodizing',current_date-1,100,'sent_to_vendor')", [f.next(), i.company, j.order, j.job]);
  await f.call("ap_planning", "predict", {}, i.productionManager);
  await f.call("ap_planning", "prepare_billet", {}, i.productionManager);
  await f.supplierBill({ accepted: istDay(-25) });
  await f.call("ap_accounts", "save_msme_vendor", { vendor_id: i.vendor, category: "micro", udyam: "UDYAM-DL-01-0000001", reason: "Synthetic preview certificate confirmed" }, i.accounts);
  await f.call("ap_digest", "prepare_digest", {}, i.owner);
  const count = await f.countedStock();
  const check = await f.call("ap_accounts", "close_checklist", { month: "2026-10" }, i.accounts);
  const exception = await f.call("ap_accounts", "request_close_exception", { month: "2026-10", fingerprint: check.fingerprint, reason: "Stock variance at ninety kg reviewed" }, i.accounts);
  await f.call("ap_accounts", "decide_close_exception", { id: exception.id, decision: "approve", reason: "Independent approval of current observations" }, i.admin);
  await f.recountStock(count);
  return item;
});
console.log(JSON.stringify({ base: browserFixture.base, itemId, screens: ["digest", "billet-forecast", "red-list", "close-checklist", "msme", "stock-ledger"].map(screen => `${browserFixture.base}/?screen=${screen}`), stock: `${browserFixture.base}/?screen=stock-movements&itemId=${itemId}` }, null, 2));
process.on("SIGINT", async () => { await browserFixture.close(); process.exit(0); });
