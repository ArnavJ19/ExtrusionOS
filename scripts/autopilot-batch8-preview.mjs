// Real batch 8 screens and gateways on a replayed local database, with synthetic operating records only.
import { createBatch8BrowserFixture } from "./lib/autopilot-batch8-browser-fixture.mjs";
import { ids as i, istDay } from "./lib/autopilot-batch8-fixture.mjs";

process.env.BATCH8_FIXTURE_PORT ??= "4188";
const fx = await createBatch8BrowserFixture();
await fx.start();
const data = await fx.run(async () => {
  const f = fx.f;
  const r = await f.receiptLine();
  const draft = await f.certificate({ line: r.line, extracted: { heat_number: { value: "H24-5521", confidence: "high", source: "Cast No: H24-5521" }, alloy: { value: "6063", confidence: "high", source: "Alloy: AA6063" },
    si: { value: 0.42, confidence: "medium", source: "Actual 0.42 0.18 0.01 0.02 0.52 0.01 0.01" }, fe: { value: 0.18, confidence: "medium", source: "Actual 0.42 0.18 0.01 0.02 0.52 0.01 0.01" } } });
  const { plan, items } = await f.plan({ items: [{ characteristic: "Wall thickness", unit: "mm", nominal: 1.4, lower: 1.3, upper: 1.5 }, { characteristic: "Coating thickness", unit: "micron", nominal: 70, lower: 60, upper: 90 }] });
  const j = await f.job({ status: "in_progress" });
  await f.readings({ job: j.job, plan, item: items[0], values: [1.42, 1.43, 1.44, 1.43, 1.45, 1.46, 1.47] });
  const planned = await f.job({ plannedIn: 2, due: 4 });
  await f.call("ap_die_window", "set", { die_id: i.die, reason: "nitriding", starts_on: istDay(0), expected_return: istDay(5), note: "Shree Nitriding Works" }, i.productionManager);
  await f.orderHistory(i.customer3, [[100, 1000], [130, 1000], [160, 1000], [190, 1000], [220, 1000]]);
  await f.call("ap_customer_health", "score_now", {}, i.owner);
  const p1 = await f.press({ name: "Press 1", code: "P1" }); await f.shifts(p1, 1000);
  await f.seed("update aluminium_profiles set compatible_presses=array['P1'] where id=$1", [i.profile2]);
  const quote = await f.draftQuote({});
  await f.seed("update quote_items set billing_weight_kg=800 where quote_id=$1", [quote.quote]);
  return { draft: draft.id, line: r.line, job: planned.job, quote: quote.quote };
});
const u = (screen, user, extra = "") => `${fx.base}/?screen=${screen}&user=${user}${extra}`;
console.log(JSON.stringify({ base: fx.base, screens: [u("certificates", i.quality), u("certificate", i.quality, `&id=${data.draft}`), u("upload", i.quality, `&line=${data.line}`),
  u("spc", i.quality), u("die", i.productionManager, `&die=${i.die}&today=${istDay(0)}&job=${data.job}`), u("health", i.salesManager, `&customer=${i.customer3}`),
  u("capacity", i.sales, `&quote=${data.quote}&profile=${i.profile2}&kg=800`), u("views", i.sales, `&rows=00000000-0000-4000-8000-000000000101,00000000-0000-4000-8000-000000000102&day=${istDay(0)}`)], today: istDay() }, null, 2));
process.on("SIGINT", async () => { await fx.close(); process.exit(0); });
