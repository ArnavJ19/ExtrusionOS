// Real batch 7 screens and gateways on a replayed local database, with synthetic operating records only.
import { createBatch7BrowserFixture } from "./lib/autopilot-batch7-browser-fixture.mjs";
import { ids as i, istDay, lastMonthRange } from "./lib/autopilot-batch7-fixture.mjs";

process.env.BATCH7_FIXTURE_PORT ??= "4187";
const fx = await createBatch7BrowserFixture();
await fx.start();
const data = await fx.run(async () => {
  const f = fx.f;
  for (const s of ["accepted", "accepted", "rejected", "rejected", "rejected", "expired"]) await f.proposal({ status: s, decidedBy: i.salesManager, role: "sales_manager" });
  await f.proposal({ status: "edited", edited: ["rate_day"], payload: { rate_day: "2026-11-01" }, decision: { rate_day: "2026-11-02" } });
  await f.purchaseOrder({ vendor: i.transporter, lines: [{ description: "Stretch film 23 micron", unit: "kg", rate: 100 }], daysAgo: 20 });
  const po = await f.purchaseOrder({ vendor: i.transporter, lines: [{ description: "Stretch film 23 micron", unit: "kg", rate: 120 }], issue: false });
  const red = await f.redLine({ estimate: 7 });
  await f.call("ap_delay", "prepare", {}, i.owner);
  await f.seed("update customers set email='accounts@sharma.invalid' where id=$1", [i.customer2]);
  await f.call("ap_statement", "prepare", { period: lastMonthRange().period }, i.accounts);
  return { po, order: red.order };
});
const u = (screen, user, extra = "") => `${fx.base}/?screen=${screen}&user=${user}${extra}`;
console.log(JSON.stringify({ base: fx.base, screens: [u("quality", i.owner), u("po-line", i.accounts), u("po-checks", i.accounts, `&orderId=${data.po}`), u("prices", i.owner),
  u("delay", i.sales), u("order-delay", i.sales, `&orderId=${data.order}`), u("statements", i.accounts), u("shared", i.dispatchManager)], today: istDay() }, null, 2));
process.on("SIGINT", async () => { await fx.close(); process.exit(0); });
