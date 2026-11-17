// Real batch 10 screens and gateways on a replayed local database, with synthetic operating records only.
import { createBatch10BrowserFixture } from "./lib/autopilot-batch10-browser-fixture.mjs";
import { ids as i, istAt, istDay } from "./lib/autopilot-batch10-fixture.mjs";

process.env.BATCH10_FIXTURE_PORT ??= "4190";
const fx = await createBatch10BrowserFixture();
await fx.start();
const data = await fx.run(async () => {
  const f = fx.f;
  const press = await f.press({ name: "Press 1 (1460 T)" }); await f.shifts(press, 1000); await f.pressSettings(press);
  await f.seed("update aluminium_profiles set billet_diameter_mm=178 where id=$1", [i.profile2]);
  // Energy and crew: two jobs pressed in today's first shift.
  const a = await f.job({ machine: press, status: "in_progress", plannedIn: 0 }), b = await f.job({ machine: press, status: "in_progress", plannedIn: 0 });
  await f.pushes({ job: a.job, machine: press, at: ["06:10", "06:15", "06:20", "06:25"].map(t => istAt(0, t)) });
  await f.pushes({ job: b.job, machine: press, at: ["06:30", "06:36", "06:42"].map(t => istAt(0, t)) });
  await f.ap("ap_energy", "save", { machine_id: press, shift_day: istDay(0), shift_name: "A", opening_kwh: 48210, closing_kwh: 48830 }, i.production);
  await f.ap("ap_crew", "sign_in", { machine_id: press, crew_role: "operator" }, i.production);
  await f.ap("ap_crew", "add", { machine_id: press, user_id: i.backup, crew_role: "puller" }, i.productionManager);
  // Combined cuts: two planned jobs of the die with different cut lengths.
  const c = await f.job({ machine: press, plannedIn: 2 }), d = await f.job({ machine: press, plannedIn: 3 });
  await f.seed("update production_jobs set length_per_piece_m=6, pieces=40 where id=$1", [c.job]);
  await f.seed("update production_jobs set length_per_piece_m=3.2, pieces=40 where id=$1", [d.job]);
  // Equivalents: an approved same-section profile with stock, and a short order line.
  const other = await f.profile({ code: "OM-2045-B" });
  await f.stock({ pieces: 60, profile: other });
  const eq = await f.ap("ap_equivalents", "propose", { profile_id: i.profile2, equivalent_profile_id: other, basis: "same_section", note: "Same die drawing, export code" }, i.sales);
  await f.ap("ap_equivalents", "approve", { id: eq.id }, i.quality);
  const short = await f.order({ kg: 285, pieces: 50, length: 6 });
  await f.seed("update production_job_draft_lines set status='removed' where order_id=$1", [short.order]);
  // Stock runs: a target, billets and a suggestion.
  await f.billets({ kg: 3000 });
  await f.ap("ap_stock_runs", "save_target", { profile_id: i.profile2, piece_length_m: 6, target_kg: 2000, max_kg: 2500 }, i.productionManager);
  await f.ap("ap_stock_runs", "suggest", {}, i.productionManager);
  // Coating queue: three shades, five jobs.
  await f.ap("ap_coating", "save_settings", { capacity_kg_per_hour: 120, changeover_minutes: 45, day_start: "08:00", hours_per_day: 8 }, i.productionManager);
  for (const [shade, kg, due] of [["RAL 9010", 600, 2], ["RAL 7016", 450, 3], ["RAL 9010", 500, 4], ["RAL 8017", 300, 4], ["RAL 7016", 350, 6]]) await f.coatingJob({ shade, kg, due });
  // Configurator project.
  await f.ap("ap_systems_order", "save_settings", { enabled: true, note: "Omalco supplies sliding systems" }, i.owner);
  const cfg = await f.configuration({ cuts: [[i.profile2, 1750, 4], [i.profile2, 1450, 4], [other, 1180, 6, "OM-2045-B"]] });
  await f.stock({ pieces: 2, length: 6 });
  return { press, job: a.job, other, order: short.order, cfg };
});
const u = (screen, user, extra = "") => `${fx.base}/?screen=${screen}&user=${user}${extra}`;
console.log(JSON.stringify({ base: fx.base, screens: [u("meters", i.production, `&today=${istDay(0)}`), u("crew", i.productionManager, `&machine=${data.press}&name=Press%201&today=${istDay(0)}`),
  u("job-energy", i.productionManager, `&job=${data.job}`), u("equivalents", i.quality, `&profile=${i.profile2}`), u("order-equivalents", i.sales, `&order=${data.order}&today=${istDay(0)}`),
  u("stock-runs", i.productionManager), u("coating", i.productionManager), u("cut", i.productionManager), u("system", i.owner, `&id=${data.cfg}`), u("system-form", i.sales, `&id=${data.cfg}`),
  u("numbers", i.sales), u("voice", i.production, "&speech=true"), u("undo", i.sales)] }, null, 2));
process.on("SIGINT", async () => { await fx.close(); process.exit(0); });
