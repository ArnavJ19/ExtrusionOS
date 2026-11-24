// Order lifecycle Phase 4 and review-fix screens on a replayed local database with synthetic records only:
//   A. a QC approval of 1000 kg with 600 kg already packaged (reverse up to 400 kg);
//   B. a containment whose earlier approval QA has revoked (reversal link, cancel hidden);
//   C. a dispatch kept pending because its order is on payment-before-dispatch terms (release, then send out);
//   D. a released dispatch whose job is put under containment afterwards (send-out refused at the gate).
// Prints the screen URLs. Usage: node --experimental-strip-types scripts/olo-phase4-preview.mjs
import { createOloPhase4BrowserFixture } from "./lib/olo-phase4-browser-fixture.mjs";

process.env.OLO_PHASE4_FIXTURE_PORT ??= "4192";
const fx = await createOloPhase4BrowserFixture();
await fx.start();
const i = fx.ids;
const data = await fx.run(async () => {
  const f = fx.f;
  const fin = (command, payload) => f.call("dispatch_finance_command", command, payload, i.accounts);
  await f.call("olo_command", "settings.save", { dispatch_release_hours: 12 }, i.factory);
  async function heldDispatch(tagPrefix) {
    const o = await f.order({});
    const job = await f.readyJob({ order: o.order, line: o.line, kg: 570 });
    const tags = [`${tagPrefix}-1`, `${tagPrefix}-2`];
    for (const tag of tags) await f.bundle({ order: o.order, job, tag });
    await fin("terms.set", { scope: "order", order_id: o.order, terms: "payment_before_dispatch", reason: "New customer: payment before dispatch agreed" });
    const s = await f.call("ap_dispatch", "start", { order_id: o.order, vehicle_number: "MH12AB1234", transporter_id: i.transporter }, i.dispatchUser);
    for (const tag of tags) await f.call("ap_dispatch", "scan", { session_id: s.id, tag }, i.dispatchUser);
    return { ...o, job, dispatch: await f.writeDispatch(s.id) };
  }
  // A. Reversal: 1000 kg approved, 600 kg already packaged.
  const a = await f.order({ kg: 1000, pieces: 175 });
  const jobA = await f.readyJob({ order: a.order, line: a.line, kg: 1000, packagedKg: 600 });
  const inspA = (await f.db.query("select id from quality_inspections where production_job_id=$1", [jobA])).rows[0].id;
  await f.seed("update quality_inspections set batch_number='LOT-A', inspector_name='QA day shift', surface_finish_ok=true, created_at=now()-interval '2 hours' where id=$1", [inspA]);
  // B. Containment with a revoked earlier approval.
  const b = await f.order({});
  const jobB = await f.readyJob({ order: b.order, line: b.line, kg: 570, approvedKg: 200, packagedKg: 0 });
  const inspB = (await f.db.query("select id from quality_inspections where production_job_id=$1", [jobB])).rows[0].id;
  await f.seed("update quality_inspections set batch_number='LOT-B', inspector_name='QA day shift', surface_finish_ok=true, created_at=now()-interval '2 hours' where id=$1", [inspB]);
  const c = await f.call("quality_containment_command", "open", { job_id: jobB, scope_kg: 370, stage: "final", defect: "Hardness below specification on sample 2", defect_kind: "non_destructive" }, i.quality);
  await f.call("quality_containment_command", "prior_review", { id: c.id, inspection_id: inspB, outcome: "revoked", method: "Webster hardness re-test", note: "Below 12 HW on 3 of 5 pieces" }, i.quality);
  // C. Finance-held dispatch.
  const held = await heldDispatch("HC");
  // D. Released, then the job goes under containment.
  const d = await heldDispatch("HD");
  await fin("release", { dispatch_id: d.dispatch, basis: "payment_confirmed", reference: "UTR-HDFC-55120", note: "RTGS seen in the bank statement" });
  await f.call("quality_containment_command", "open", { job_id: d.job, scope_kg: 10, stage: "final", defect: "Surface streaks found on a retained sample", defect_kind: "non_destructive" }, i.quality).catch(async () => {
    await f.seed(`insert into quality_containments(company_id,containment_number,production_job_id,order_id,stage,defect,defect_kind,inspection_mode,scope_kg,status,opened_by)
      values($1,'QCH/26-27/0099',$2,$3,'final','Surface streaks found on a retained sample','non_destructive','full_inspection',10,'open',$4)`, [i.company, d.job, d.order, i.quality]);
  });
  // E. A finished job with 270 kg not yet given a QC record (offered on the hold-a-lot form).
  const e = await f.order({});
  await f.readyJob({ order: e.order, line: e.line, kg: 570, approvedKg: 300, packagedKg: 0 });
  return { inspection: inspA, containment: c.id, revokedInspection: inspB, held: held.dispatch, contained: d.dispatch };
});
const u = (screen, user, extra = "") => `${fx.base}/?screen=${screen}&user=${user}${extra}`;
console.log(JSON.stringify({ base: fx.base, users: { quality: i.quality, factory: i.factory, accounts: i.accounts, dispatch: i.dispatchUser }, screens: [
  u("reverse", i.quality, `&inspection=${data.inspection}`), u("reverse", i.quality, `&inspection=${data.inspection}&lang=hi`),
  u("containment", i.quality, `&id=${data.containment}`), u("containment", i.quality, `&id=${data.containment}&lang=hi`),
  u("reverse", i.quality, `&inspection=${data.revokedInspection}`),
  u("clearance", i.accounts, `&dispatch=${data.held}`), u("clearance", i.dispatchUser, `&dispatch=${data.held}`),
  u("clearance", i.dispatchUser, `&dispatch=${data.contained}`), u("alerts", i.factory), u("hold", i.quality), u("alerts", i.productionManager)] }, null, 2));
process.on("SIGINT", async () => { await fx.close(); process.exit(0); });
