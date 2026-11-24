// Order lifecycle Phase 6 screens on a replayed local database with synthetic records only: one order with three packed
// bundles (two to send), a holding location, and one transfer already sent by production for dispatch to scan in.
// Prints the screen URLs. Usage: node --experimental-strip-types scripts/olo-phase6-preview.mjs
import { createOloPhase6BrowserFixture } from "./lib/olo-phase6-browser-fixture.mjs";

process.env.OLO_PHASE6_FIXTURE_PORT ??= "4194";
const fx = await createOloPhase6BrowserFixture();
await fx.start();
const i = fx.ids;
const LOC = "0e6f0000-0000-4000-8000-000000000001";
const data = await fx.run(async () => {
  const f = fx.f;
  await f.seed("insert into inventory_locations(id,company_id,location_code,location_name,location_type) values($1,$2,'FG-1','Dispatch bay 1','factory')", [LOC, i.company]);
  const o = await f.order({ kg: 570 });
  const job = await f.readyJob({ order: o.order, line: o.line, kg: 570, number: "JOB-P6-A" });
  const b = {};
  for (const tag of ["P6-B1", "P6-B2", "P6-B3", "P6-B4"]) b[tag] = await f.bundle({ order: o.order, job, tag });
  const sent = await f.call("packaging_flow_command", "fg.send", { id: "0e6f0000-0000-4000-8000-000000000002", location_id: LOC, bundle_ids: [b["P6-B3"], b["P6-B4"]] }, i.production);
  return { transfer: sent.id };
});
const u = (screen, user, extra = "") => `${fx.base}/?screen=${screen}&user=${user}${extra}`;
console.log(JSON.stringify({ base: fx.base, screens: [
  u("send", i.production), u("send", i.production, "&lang=hi"), u("transfer", i.dispatchUser, `&id=${data.transfer}`), u("transfer", i.production, `&id=${data.transfer}`),
  u("trace", i.quality, "&tag=P6-B3")] }, null, 2));
process.on("SIGINT", async () => { await fx.close(); process.exit(0); });
