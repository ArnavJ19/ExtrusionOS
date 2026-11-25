// Real foundry scrap receiving screens and gateway on a replayed local database, with synthetic records only.
import { createScrapReceivingBrowserFixture } from "./lib/foundry-scrap-receiving-browser-fixture.mjs";
import { ids as i } from "./lib/fs-batch4-fixture.mjs";

process.env.SCRAP_RECEIVING_FIXTURE_PORT ??= "4191";
const fx = await createScrapReceivingBrowserFixture();
await fx.start();
const data = await fx.run(async () => {
  const f = fx.f;
  const call = (command, payload, actor) => f.call("ap_scrap_receipt", command, payload, actor);
  const wire = (await call("types", {}, i.production)).types.find(t => t.code === "local_extrusion_with_attachments");
  const request = await call("request", { scrap_type_id: wire.id, alloy: "6063", quantity_kg: 8000, purpose: "6063 charge for furnace 2 next week" }, i.production);
  // A receiver (production manager) who already tried to leave five times; the factory manager decides.
  const stuck = await call("start", { present: false, proxy_name: "Ramesh Patil", proxy_phone: "9822012345", proxy_reason: "At the furnace during tapping" }, i.productionManager);
  for (let n = 0; n < 4; n += 1) await call("abort", { receipt_id: stuck.id }, i.productionManager);
  await call("abort", { receipt_id: stuck.id, reason: "Called to press 2 for a die failure" }, i.productionManager);
  return { request: request.id, stuck: stuck.id };
});
const u = (screen, user, extra = "") => `${fx.base}/?screen=${screen}&user=${user}${extra}`;
console.log(JSON.stringify({ base: fx.base, screens: [u("receive", i.production, `&request=${data.request}`), u("requests", i.production), u("receipts", i.factory, "&status=exit_requested"),
  u("receipt", i.factory, `&id=${data.stuck}`), u("finance", i.accounts), u("types", i.factory, "&canManage=true")] }, null, 2));
process.on("SIGINT", async () => { await fx.close(); process.exit(0); });
