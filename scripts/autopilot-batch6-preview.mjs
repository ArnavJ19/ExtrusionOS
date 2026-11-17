// Real batch 6 screens and gateways on a replayed local database, with synthetic operating records only.
import { createBatch6BrowserFixture } from "./lib/autopilot-batch6-browser-fixture.mjs";
import { ids as i, istDay } from "./lib/autopilot-batch6-fixture.mjs";

process.env.BATCH6_FIXTURE_PORT ??= "4186";
const fx = await createBatch6BrowserFixture("ops");
await fx.start();
const data = await fx.run(async () => {
  const f = fx.f;
  await f.seed("update aluminium_profiles set weight_tolerance_percent=2 where id=$1", [i.profile2]);
  await f.dieJob({ kgms: [0.97, 0.99, 1.0, 1.01, 1.0] });
  await f.call("ap_weight", "prepare", {}, i.quality);
  await f.draftQuote({ rate: 230 }); await f.sentQuote({ boundRate: 232 });
  await f.consumable({ stock: 12 });
  await f.seed(`insert into system_job_runs(company_id,job_key,window_key,trigger_source,status,started_at,finished_at,examined,proposals_created,alerts_created,error_message)
    values($1,'quotes.expire','day:20261114','cron','failed',now(),now(),0,0,0,'Synthetic failure for the preview')`, [i.company]);
  await f.dieJob({ rejected: 20, actual: 180 });
  await f.call("ap_ncr", "save_settings", { job_reject_percent: 5 }, i.quality);
  await f.call("ap_ncr", "detect", {}, i.quality);
  await f.call("ap_tds", "save_settings", { sections: ["194Q"], default_section: "194Q", default_rate_percent: 0.1, basis: "taxable", tolerance_inr: 1 }, i.accounts);
  await f.receipt(i.inv1, 9990);
  return { ncr: (await f.one("select id from quality_ncrs limit 1")).id };
});
const u = (screen, user, extra = "") => `${fx.base}/?screen=${screen}&user=${user}${extra}`;
console.log(JSON.stringify({ base: fx.base, screens: [u("weight", i.quality), u("die-weight", i.productionManager, `&dieId=${i.die}`), u("reprice", i.owner), u("health", i.owner),
  u("reorder", i.inventory), u("ncrs", i.quality), u("ncr", i.quality, `&ncrId=${data.ncr}`), u("einvoice", i.accounts), u("tds", i.accounts)], today: istDay() }, null, 2));
process.on("SIGINT", async () => { await fx.close(); process.exit(0); });
