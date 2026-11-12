// Serves the Autopilot batch 4 screens on the replayed local database with a small demo data set, for checking the
// screens in a browser (no hosted database involved). Prints the screen URLs. Usage: node --experimental-strip-types scripts/autopilot-batch4-preview.mjs
import { createDispatchBrowserFixture } from "./lib/autopilot-batch4-browser-fixture.mjs";
import { dIds as i, istDay, nid } from "./lib/autopilot-batch4-fixture.mjs";

process.env.DISPATCH_FIXTURE_PORT ??= "4174";
const fixture = await createDispatchBrowserFixture();
await fixture.start();
const ids = await fixture.run(async () => {
  const f = fixture.f;
  await f.seed(`insert into packing_label_templates(id,company_id,scope,revision,status,instructions,label_fields,spacer_required,created_by,approved_by,approved_at)
    values($1,$2,'company',1,'approved','Wrap and label both ends',$3,false,$4,$5,now())`, [nid(7300), i.company, ["bundle_number", "order_number", "customer", "profile_code", "pieces", "net_kg"], i.dispatchManager, i.owner]);
  await f.ap("ap_dispatch", "save_station", { name: "Packing table 1", is_default: true, auto_print: false }, i.dispatchManager);
  await f.ap("ap_dispatch", "save_pack_spec", { customer_id: i.customer2, max_bundle_kg: 120, max_pieces: 25, wrapping: "stretch_film", interleaving_paper: true, battens_per_bundle: 2,
    material_ids: [i.film, i.paper], reason: "Customer packing sheet dated 1 Nov" }, i.dispatchManager);
  await f.ap("ap_freight", "save_card", { transporter_id: i.transporter, basis: "per_kg", destination_state: "27", destination_city: "Pune", rate: 3.8, min_charge: 1500, effective_from: istDay(-5) }, i.dispatchManager);
  const o = await f.order({});
  const job = await f.readyJob({ order: o.order, line: o.line, kg: 570 });
  for (const tag of ["PV-1", "PV-2", "PV-3"]) await f.bundle({ order: o.order, job, tag });
  const o2 = await f.order({});
  const job2 = await f.readyJob({ order: o2.order, line: o2.line, kg: 570 });
  await f.bundle({ order: o2.order, job: job2, tag: "PV-G1" });
  const s2 = await f.ap("ap_dispatch", "start", { order_id: o2.order, vehicle_number: "MH12AB1234", transporter_name: "VRL Logistics" });
  await f.ap("ap_dispatch", "scan", { session_id: s2.id, tag: "PV-G1" });
  const dispatchId = await f.writeDispatch(s2.id);
  await f.ap("ap_dispatch", "complete", { id: s2.id, dispatch_id: dispatchId });
  const s = await f.ap("ap_dispatch", "start", { order_id: o.order, vehicle_number: "MH14CD5678", transporter_name: "VRL Logistics" });
  await f.ap("ap_dispatch", "scan", { session_id: s.id, tag: "PV-1" });
  return { order: o.order, session: s.id, dispatchId };
});
const u = (screen, user, extra = "") => `${fixture.base}/?screen=${screen}&user=${user}${extra}`;
console.log(JSON.stringify({
  station: u("station", i.dispatchUser, `&sessionId=${ids.session}`), gate: u("gate", i.dispatchUser), ready: u("ready", i.sales), labels: u("labels", i.dispatchUser),
  order: u("order", i.sales, `&orderId=${ids.order}`), dispatch: u("dispatch", i.dispatchManager, `&dispatchId=${ids.dispatchId}`), eway: u("eway", i.accounts), tally: u("tally", i.accounts),
  freight: u("freight", i.dispatchManager), packing: u("packing", i.dispatchManager)
}, null, 2));
process.on("SIGINT", async () => { await fixture.close(); process.exit(0); });
