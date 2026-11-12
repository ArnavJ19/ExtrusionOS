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
  await f.call("ap_planning", "predict", {}, i.productionManager);
  await f.call("ap_planning", "prepare_billet", {}, i.productionManager);
  await f.supplierBill({ accepted: istDay(-25) });
  await f.call("ap_accounts", "save_msme_vendor", { vendor_id: i.vendor, category: "micro", udyam: "UDYAM-DL-01-0000001", reason: "Synthetic preview certificate confirmed" }, i.accounts);
  await f.call("ap_digest", "prepare_digest", {}, i.owner);
  return item;
});
console.log(JSON.stringify({ base: browserFixture.base, itemId, screens: ["digest", "billet-forecast", "red-list", "close-checklist", "msme", "stock-ledger"].map(screen => `${browserFixture.base}/?screen=${screen}`), stock: `${browserFixture.base}/?screen=stock-movements&itemId=${itemId}` }, null, 2));
process.on("SIGINT", async () => { await browserFixture.close(); process.exit(0); });
