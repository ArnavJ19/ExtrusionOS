import test from "node:test";
import assert from "node:assert/strict";
import { createBatch4Fixture, ids as i, istDay } from "../scripts/lib/fs-batch4-fixture.mjs";

// FABLE_SUGGESTIONS batch 4 database behaviour (FS-82, 77, 132, 125, 79, 07, 51, 65, 75). Expected values are worked
// out by hand from the seeded quantities, not read back from the functions under test.
let f;
test.before(async () => { f = await createBatch4Fixture(); });
test.after(async () => { await f?.close(); });
test.beforeEach(async () => { await f.start(); });
test.afterEach(async () => { await f.rollback(); });
const denied = e => e.code === "42501";
const num = v => (v === null || v === undefined ? v : Number(v));
const one = async (sql, params = []) => (await f.db.query(sql, params)).rows[0];

// ---------------------------------------------------------------- FS-82
test("FS-82 one business date: today in India, the shift day of the night shift and the Indian financial year", async () => {
  const r = await one("select private.business_today()::text t, private.ist_today()::text a, ((now() at time zone 'Asia/Kolkata')::date)::text e");
  assert.equal(r.t, r.e); assert.equal(r.a, r.e);
  assert.equal(r.t, istDay(0));
  // 21:30 UTC on 18 Nov is 03:00 IST on 19 Nov: the C shift that started at 22:00 IST on the 18th.
  const night = await one("select code, shift_date::text d from private.business_shift($1, '2026-11-18T21:30:00Z')", [i.company]);
  assert.deepEqual([night.code, night.d], ["C", "2026-11-18"]);
  const late = await one("select code, shift_date::text d from private.business_shift($1, '2026-11-18T18:29:00Z')", [i.company]); // 23:59 IST
  assert.deepEqual([late.code, late.d], ["C", "2026-11-18"]);
  const morning = await one("select code, shift_date::text d from private.business_shift($1, '2026-11-19T00:30:00Z')", [i.company]); // 06:00 IST
  assert.deepEqual([morning.code, morning.d], ["A", "2026-11-19"]);
  const fy = await one("select private.business_financial_year('2027-03-31') a, private.business_financial_year('2027-04-01') b");
  assert.equal(fy.a.label, "2026-27"); assert.equal(fy.b.label, "2027-28");
  assert.equal(fy.a.starts_on, "2026-04-01"); assert.equal(fy.a.ends_on, "2027-03-31");
  assert.equal(num((await one("select private.business_date_of('2026-11-18T19:00:00Z')::text d")).d === "2026-11-19"), 1, "00:30 IST is the next business day");
  const cal = (await f.asUser("select public.business_calendar() c", [], i.production))[0].c;
  assert.equal(cal.today, istDay(0)); assert.equal(cal.time_zone, "Asia/Kolkata"); assert.ok(cal.shift?.code);
});

test("FS-82 no function body or date column default reads the server date any more", async () => {
  const bodies = (await f.db.query(`select n.nspname || '.' || p.proname f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and (p.prosrc ~* '\\mcurrent_date\\M' or p.prosrc ~* 'now\\(\\)\\s*::\\s*date')
      and p.proname not in ('business_today', 'ist_today')`)).rows.map(r => r.f);
  assert.deepEqual(bodies, [], "use private.business_today()");
  const defaults = (await f.db.query(`select table_name || '.' || column_name c from information_schema.columns
    where table_schema = 'public' and (column_default ~* '\\mcurrent_date\\M' or column_default ~* 'now\\(\\)\\s*::\\s*date')`)).rows.map(r => r.c);
  assert.deepEqual(defaults, []);
  assert.match((await one("select column_default d from information_schema.columns where table_name='breakdown_logs' and column_name='breakdown_date'")).d, /business_today/);
});

// ---------------------------------------------------------------- FS-77 / FS-132
test("FS-77 KPI values follow the dictionary: recovery over billet input, not captured when any job lacks input, finance only for finance roles", async () => {
  const base = await f.ap("fs_kpi", "values", {}, i.owner);
  // Job A: 1000 kg out, 50 kg QC-rejected, 1200 kg billet in. Job B: 500 kg out, 600 kg in, 20 kg process scrap.
  await f.job({ kg: 1000, input: 1200, rejected: 50 });
  await f.job({ kg: 500, input: 600, scrap: 20 });
  let v = await f.ap("fs_kpi", "values", {}, i.owner);
  const good = 950 + 500; // billet input 1200 + 600 = 1800 kg
  assert.equal(num(v.recovery.numerator) - num(base.recovery.numerator ?? 0), good);
  assert.equal(num(v.production_completed_kg.value) - num(base.production_completed_kg.value), 1500);
  assert.equal(num(base.recovery.denominator), 0, "the fixture has no job completed today");
  assert.equal(v.recovery.status, "measured");
  assert.equal(num(v.recovery.value), 80.56, "1450 / 1800 = 80.555...%");
  assert.equal(num(v.oee_quality.value), 96.67, "quality = good / output = 1450 / 1500");
  assert.equal(num(v.process_scrap_percent.value), 1.11, "20 / 1800 = 1.111...%");
  // A completed job with no billet input makes recovery "not captured", never a number.
  await f.job({ kg: 300 });
  v = await f.ap("fs_kpi", "values", {}, i.owner);
  assert.equal(v.recovery.status, "not_captured");
  assert.equal(v.recovery.value, null);
  assert.match(v.recovery.note, /no issued billet input/);
  // OEE parts without data are not measurable, not zero; no target is stored.
  for (const k of ["oee", "oee_availability", "oee_performance", "conversion_cost_per_tonne"]) { assert.equal(v[k].status, "not_measurable", k); assert.equal(v[k].value, null); }
  // Finance KPIs only for owner, admin and accounts.
  const sm = await f.ap("fs_kpi", "values", {}, i.salesManager);
  assert.equal("order_intake" in sm, false); assert.equal("dso_days" in sm, false);
  assert.ok("order_intake" in (await f.ap("fs_kpi", "values", {}, i.accounts)));
  await assert.rejects(() => f.ap("fs_kpi", "values", {}, i.production), denied);
  await assert.rejects(() => f.ap("fs_kpi", "values", { from: "2025-01-01", to: istDay(0) }, i.owner), /up to 366 days/);
  const foreign = await f.ap("fs_kpi", "values", {}, i.foreign);
  assert.equal(num(foreign.production_completed_kg.value), 0, "another company sees nothing of this one");
});

test("FS-77 DSO and kWh per tonne: outstanding over average daily net invoicing; electricity over completed tonnes", async () => {
  const before = await f.ap("fs_kpi", "values", {}, i.owner);
  const inv = await f.invoice({ kg: 1000, rate: 300 }); // 300,000 + 18% = 354,000 outstanding, invoiced 3 days ago
  const v = await f.ap("fs_kpi", "values", {}, i.owner);
  const out = num(v.dso_days.numerator), daily = num(v.dso_days.denominator);
  assert.equal(Math.round((out - num(before.dso_days.numerator)) * 100) / 100, 354000);
  assert.equal(num(v.dso_days.value), Math.round(out / daily * 10) / 10);
  assert.ok(inv.invoice);
  await f.job({ kg: 2000, input: 2300 });
  await f.seed("insert into energy_readings(id,company_id,machine_id,reading_date,energy_type,consumption,unit) values($1,$2,'P1',current_date,'electricity',1300,'kWh')", [f.next(), i.company]);
  const e = await f.ap("fs_kpi", "values", {}, i.owner);
  assert.equal(e.kwh_per_tonne.status, "measured");
  assert.equal(num(e.kwh_per_tonne.value), Math.round(num(e.kwh_per_tonne.numerator) / (num(e.production_completed_kg.value) / 1000) * 100) / 100);
});

test("FS-132 Command Center, analytics and the dashboard show the same figures for the same period", async () => {
  const o1 = await f.order({ kg: 800 }), o2 = await f.order({ kg: 400 });
  await f.shipment({ order: o1.order, line: o1.line, kg: 812.5, expectedOffset: 2 });  // on time
  await f.shipment({ order: o2.order, line: o2.line, kg: 401.25, expectedOffset: -3 }); // late
  await f.job({ kg: 640, input: 700 });
  await f.quote({ status: "converted_to_order", daysAgo: 0 }); await f.quote({ status: "sent", daysAgo: 0 }); await f.quote({ status: "draft", daysAgo: 0, sent: false });
  await f.seed(`insert into payments(id,company_id,invoice_id,amount,payment_date,payment_status,payment_method,payment_type) values($1,$2,$3,25000,current_date,'PAID','bank_transfer','FINAL_PAYMENT')`, [f.next(), i.company, (await f.invoice({ kg: 100, rate: 300 })).invoice]);
  const today = istDay(0), monthStart = `${today.slice(0, 8)}01`;
  const k = await f.ap("fs_kpi", "values", { from: monthStart, to: today }, i.owner);
  const a = (await f.asUser("select public.get_advanced_analytics_snapshot($1, 6) s", [today], i.owner))[0].s.kpis;
  const d = (await f.asUser("select public.get_dashboard_snapshot($1) s", [today], i.owner))[0].s;
  assert.equal(num(k.shipped_kg.value), num(a.dispatchWeightMtd));
  assert.equal(num(k.production_completed_kg.value), num(a.productionActualKgMtd));
  assert.equal(num(k.production_planned_kg.value), num(a.productionPlannedKgMtd));
  assert.equal(num(k.order_intake.value), num(a.bookedRevenueMtd));
  assert.equal(num(k.order_intake.value), num(d.monthlyOrderValue));
  assert.equal(num(k.collections.value), num(a.collectionsMtd));
  assert.equal(num(k.receivables_outstanding.value), num(a.receivableOutstanding));
  assert.equal(num(k.quote_win_rate.value), Math.round(num(a.quoteConversionRateMtd) * 100) / 100);
  assert.equal(num(k.on_time_dispatch.value), Math.round(num(a.dispatchOnTimeRate) * 100) / 100);
  // The two shipments were added in full: 812.5 + 401.25 kg of packed net weight, one of two on time.
  assert.ok(num(k.shipped_kg.value) >= 1213.75);
});

// ---------------------------------------------------------------- FS-125
test("FS-125 die health is keyed to the die and written from usage, rejections, corrections, nitriding and rated life", async () => {
  const die = f.next();
  await f.raw("insert into dies(id,company_id,die_number,profile_id,die_status,die_life_tons,die_cost) values($1,$2,$3,$4,'active',2,60000)", [die, i.company, `D-B4-${die.slice(-4)}`, i.profile2]);
  const metric = () => one("select * from die_health_metrics where die_id=$1", [die]);
  assert.ok(await metric(), "a new die gets its row");
  const j1 = await f.job({ kg: 900, input: 1000, rejected: 30, die }), j2 = await f.job({ kg: 400, input: 450, die });
  await f.raw("update dies set total_production_kg = 1300, total_runs = 2 where id=$1", [die]);
  let m = await metric();
  assert.equal(num(m.total_output_kg), 1300);
  assert.equal(num(m.total_rejection_kg), 30);
  assert.equal(num(m.rejection_rate), Math.round(30 * 100 / 1300 * 100) / 100, "30 / 1300 = 2.31%");
  assert.equal(num(m.rated_life_kg), 2000);
  assert.equal(num(m.life_used_percent), 65, "1300 / 2000");
  assert.equal(num(m.cost_per_kg), Math.round(60000 / 1300 * 10000) / 10000);
  assert.equal(m.recovery_trend, "not_enough_runs");
  assert.equal(m.recommendation, "healthy");
  // An open correction makes it correction_needed; closing it and passing rated life makes it replace_soon.
  const corr = f.next();
  await f.raw("insert into die_corrections(id,company_id,die_id,correction_date,correction_reason,result_status) values($1,$2,$3,current_date,'die_lines','pending')", [corr, i.company, die]);
  m = await metric();
  assert.deepEqual([m.correction_count, m.open_correction_count, m.recommendation], [1, 1, "correction_needed"]);
  await f.raw("update die_corrections set result_status='success' where id=$1", [corr]);
  await f.raw("update dies set total_production_kg = 2100 where id=$1", [die]);
  m = await metric();
  assert.deepEqual([m.open_correction_count, num(m.life_used_percent), m.recommendation], [0, 105, "replace_soon"]);
  // Nitriding: kg since nitriding counts the jobs completed after it.
  await f.raw("insert into die_nitriding_history(id,company_id,die_id,nitriding_date,status) values($1,$2,$3,current_date-1,'completed')", [f.next(), i.company, die]);
  m = await metric();
  assert.equal(num(m.kg_since_nitriding), 1300, "both jobs completed today, after yesterday's nitriding");
  assert.deepEqual([m.runs_since_nitriding, m.billets_since_nitriding], [2, 2], "one issued billet per fixture job");
  assert.ok(j1 && j2);
  // Only the database writes the metrics.
  await assert.rejects(() => f.asUser("update die_health_metrics set health_score=100 where die_id=$1", [die], i.productionManager), denied);
  await assert.rejects(() => f.asUser("insert into die_health_metrics(company_id,die_id) values($1,$2)", [i.company, f.next()], i.productionManager), denied);
  assert.equal(num((await one("select count(*) n from die_health_metrics m where not exists (select 1 from dies d where d.id=m.die_id)")).n), 0);
});

// ---------------------------------------------------------------- FS-79
test("FS-79 a record's history shows who changed which field from what, hides cost from roles that may not see it, and respects page access", async () => {
  await f.asUser("update customers set payment_terms='45 days' where id=$1", [i.customer2], i.salesManager);
  const h = await f.ap("fs_history", "record", { entity_type: "customer", entity_id: i.customer2 }, i.accounts);
  const change = h.rows.find(r => r.kind === "changed" && r.changes.some(c => c.field === "payment_terms"));
  assert.ok(change, "the change is listed");
  assert.equal(change.actor, "Fixture salesManager");
  assert.deepEqual(change.changes.find(c => c.field === "payment_terms").new, "45 days");

  const jobId = await f.job({ kg: 0, planned: 100, status: "planned" });
  await f.raw("select set_config('request.jwt.claim.sub',$1,true)", [i.productionManager]);
  await f.raw("update production_jobs set internal_cost=12345, remarks='Re-run after die polish' where id=$1", [jobId]);
  await f.raw("select set_config('request.jwt.claim.sub','',true)");
  const asProduction = await f.ap("fs_history", "record", { entity_type: "production_job", entity_id: jobId }, i.production);
  const cost = asProduction.rows.flatMap(r => r.changes).find(c => c.field === "internal_cost");
  assert.deepEqual([cost.hidden, cost.new], [true, null], "production does not see internal cost");
  assert.equal(asProduction.rows.flatMap(r => r.changes).find(c => c.field === "remarks").new, "Re-run after die polish");
  const asOwner = await f.ap("fs_history", "record", { entity_type: "production_job", entity_id: jobId }, i.owner);
  assert.equal(num(asOwner.rows.flatMap(r => r.changes).find(c => c.field === "internal_cost").new), 12345);

  await assert.rejects(() => f.ap("fs_history", "record", { entity_type: "production_job", entity_id: jobId }, i.accounts), denied, "accounts cannot open production jobs");
  await assert.rejects(() => f.ap("fs_history", "record", { entity_type: "customer", entity_id: i.customer2 }, i.foreign), denied);
  await assert.rejects(() => f.ap("fs_history", "record", { entity_type: "ledger", entity_id: i.customer2 }, i.owner), /not available/);
  assert.equal(h.page_size, 10);
});

// ---------------------------------------------------------------- FS-07
test("FS-07 browser errors are stored without personal data, alert the owner once a day, and job failures alert until a run succeeds", async () => {
  await f.ap("fs_monitoring", "report", { route: `/orders/${i.order}?q=sharma`, name: "TypeError", message: "Cannot read rate 245.50 for ramesh@example.com", digest: "abc123" }, i.production);
  await f.ap("fs_monitoring", "report", { route: `/orders/${i.order}`, name: "TypeError", message: "Cannot read rate 245.50 for ramesh@example.com" }, i.production);
  const rows = (await f.db.query("select route, message, role, fingerprint from app_error_events where company_id=$1", [i.company])).rows;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].route, "/orders/[id]");
  assert.equal(rows[0].message, "Cannot read rate # for [email]");
  assert.equal(rows[0].role, "production");
  assert.equal(rows[0].fingerprint, rows[1].fingerprint, "same error, same fingerprint");
  const alerts = (await f.db.query("select recipient_role from notifications where company_id=$1 and condition_key like 'fs07:error:%' order by 1", [i.company])).rows.map(r => r.recipient_role);
  assert.deepEqual(alerts, ["admin", "owner"], "one alert each for owner and admin, not one per occurrence");
  await assert.rejects(() => f.ap("fs_monitoring", "health", {}, i.production), denied);
  const health = await f.ap("fs_monitoring", "health", {}, i.owner);
  assert.equal(num(health.top_errors[0].count), 2);
  assert.equal(num(health.errors_7d), 2);
  await assert.rejects(() => f.asUser("select count(*) from app_error_events", [], i.owner), denied, "no direct table access");
  await assert.rejects(() => f.asUser("select public.fs_monitoring_service('health','{}')", [], i.owner), denied);

  const run = f.next();
  await f.db.query("insert into system_job_runs(id,company_id,job_key,window_key,trigger_source,status,started_at,error_message) values($1,$2,'digest.morning','day:20261118','cron','failed',now(),'timeout for 9810000001')", [run, i.company]);
  const open = () => f.db.query("select body from notifications where company_id=$1 and condition_key='fs07:job:digest.morning' and resolved_at is null", [i.company]).then(r => r.rows);
  assert.equal((await open()).length, 2);
  assert.match((await open())[0].body, /timeout for #/);
  await f.db.query("insert into system_job_runs(id,company_id,job_key,window_key,trigger_source,status,started_at,finished_at) values($1,$2,'digest.morning','day:20261119','cron','succeeded',now(),now())", [f.next(), i.company]);
  assert.equal((await open()).length, 0, "a later successful run resolves the alert");
  const svc = (await f.asService("select public.fs_monitoring_service('health','{}') h"))[0].h;
  assert.equal(svc.database, "ok");
});

// ---------------------------------------------------------------- FS-51
test("FS-51 sign-ins are recorded by the server, five failures lock the account for 15 minutes, and browser writes to the login log are refused", async () => {
  await f.ap("fs_security", "login_success", { ip: "203.0.113.7", user_agent: "Chrome" }, i.sales);
  const row = await one("select company_id, event_type, ip_address from login_events where user_id=$1 order by created_at desc limit 1", [i.sales]);
  assert.deepEqual([row.company_id, row.event_type, row.ip_address], [i.company, "login_success", "203.0.113.7"]);
  await assert.rejects(() => f.asUser("insert into login_events(company_id,user_id,event_type) values($1,$2,'login_success')", [i.company, i.owner], i.owner), denied);
  const email = "sales@nov3.invalid";
  for (let n = 1; n <= 4; n += 1) {
    const r = (await f.asService("select public.fs_security_service('failed', $1) r", [{ email, ip: "203.0.113.9" }]))[0].r;
    assert.equal(r.locked, false, `attempt ${n}`);
  }
  assert.equal((await f.asService("select public.fs_security_service('failed', $1) r", [{ email }]))[0].r.locked, true, "the fifth failure locks");
  assert.equal((await f.asService("select public.fs_security_service('check', $1) r", [{ email: "SALES@nov3.invalid" }]))[0].r.locked, true);
  assert.equal((await f.asService("select public.fs_security_service('failed', $1) r", [{ email: "nobody@nowhere.invalid" }]))[0].r.locked, false, "unknown e-mail: nothing recorded, nothing revealed");
  await assert.rejects(() => f.asUser("select public.fs_security_service('check', $1)", [{ email }], i.owner), denied);
  const hist = await f.ap("fs_security", "login_history", {}, i.owner);
  assert.equal(num(hist.failed_24h), 5);
  await assert.rejects(() => f.ap("fs_security", "login_history", {}, i.sales), denied);
  const bucket = await one("select file_size_limit, allowed_mime_types from storage.buckets where id='documents'");
  if (bucket) { assert.equal(num(bucket.file_size_limit), 10485760); assert.ok(bucket.allowed_mime_types.includes("application/pdf")); assert.ok(!bucket.allowed_mime_types.includes("text/html")); }
});

// ---------------------------------------------------------------- FS-65
test("FS-65 one weight comparison: theoretical = pieces x length x kg/m, difference against the profile tolerance; basis decided only by the owner and audited", async () => {
  const w = await one("select private.weight_compare(10, 6, 0.95, 58.2, 2) a, private.weight_compare(10, 6, 0.95, 58.2, 2.5) b, private.weight_compare(10, 6, null, 58.2, 2) c, private.weight_compare(10, 6, 0.95, 55.9, null) d");
  assert.equal(num(w.a.theoretical_kg), 57); // 10 x 6 x 0.95
  assert.equal(num(w.a.difference_kg), 1.2);
  assert.equal(num(w.a.difference_percent), 2.11); // 1.2 / 57 = 2.105%
  assert.deepEqual([w.a.state, w.b.state, w.c.state, w.d.state], ["heavy", "within", "no_theoretical", "no_tolerance"]);

  let p = await f.ap("fs_weight_basis", "policy", {}, i.accounts);
  assert.deepEqual([p.stock_basis, p.invoice_basis, p.can_decide], ["actual_kg", null, false], "starts undecided");
  await assert.rejects(() => f.ap("fs_weight_basis", "save_policy", { invoice_basis: "theoretical", reason: "Decided" }, i.accounts), denied);
  await assert.rejects(() => f.ap("fs_weight_basis", "save_policy", { invoice_basis: "theoretical", default_tolerance_percent: 30, reason: "Owner decision" }, i.owner), /between 0 and 25/);
  await f.ap("fs_weight_basis", "save_policy", { invoice_basis: "actual_weighed", default_tolerance_percent: 2, reason: "Owner decision 18 Nov" }, i.owner);
  await f.ap("fs_weight_basis", "save_customer", { customer_id: i.customer2, invoice_basis: "theoretical", reason: "Contract bills theoretical weight" }, i.owner);
  p = await f.ap("fs_weight_basis", "policy", {}, i.owner);
  assert.equal(p.invoice_basis, "actual_weighed");
  assert.equal(p.customers[0].invoice_basis, "theoretical");
  assert.equal(p.events.length, 3, "basis, tolerance and the customer override are each recorded");
  await assert.rejects(() => f.raw("delete from weight_basis_events where company_id=$1", [i.company]), /cannot be changed/);

  const o = await f.order({ kg: 57 });
  const s = await f.shipment({ order: o.order, line: o.line, kg: 58.2, pieces: 10, cutLength: 6 });
  const dw = await f.ap("fs_weight_basis", "dispatch_weights", { dispatch_id: s.dispatch }, i.dispatchUser);
  assert.deepEqual([dw.basis.basis, dw.basis.source], ["theoretical", "customer"]);
  const line = dw.lines[0];
  assert.deepEqual([num(line.theoretical_kg), num(line.actual_kg), line.state, line.tolerance_source], [57, 58.2, "heavy", "company"]);
  assert.equal(num(dw.outside_tolerance), 1);
  await assert.rejects(() => f.ap("fs_weight_basis", "dispatch_weights", { dispatch_id: s.dispatch }, i.foreign), denied);
});

// ---------------------------------------------------------------- FS-75
test("FS-75 the authority matrix decides who approves, needs a second different approver above its threshold, and never lets anyone approve their own entry", async () => {
  // Without a rule the built-in rule still applies: the sales manager approves a normal quotation.
  const q0 = await f.reviewQuote({ total: 50000 });
  await f.decide("quote", q0, "approve", i.salesManager);
  assert.equal((await one("select status from quotes where id=$1", [q0])).status, "approved_for_sending");

  await assert.rejects(() => f.ap("fs_authority", "save_rule", { transaction_type: "quote", approver_roles: ["sales_manager"], reason: "Policy" }, i.admin), denied);
  await f.ap("fs_authority", "save_rule", { transaction_type: "quote", min_amount: 0, max_amount: null, approver_roles: ["sales_manager", "admin", "owner"], second_approver_from: 100000,
    second_approver_roles: ["owner", "admin"], reason: "Owner's approval policy, Nov 2026" }, i.owner);
  await assert.rejects(() => f.ap("fs_authority", "save_rule", { transaction_type: "quote", min_amount: 50000, approver_roles: ["owner"], reason: "Overlapping band" }, i.owner), /overlaps/);

  const q1 = await f.reviewQuote({ total: 150000 });
  await f.decide("quote", q1, "approve", i.salesManager);
  assert.equal((await one("select status from quotes where id=$1", [q1])).status, "internal_review", "first of two approvals: still in review");
  const awaiting = await f.ap("fs_authority", "awaiting", {}, i.owner);
  assert.ok(awaiting.some(a => a.source_id === q1));
  await assert.rejects(() => f.decide("quote", q1, "approve", i.salesManager), /second, different person/);
  await f.decide("quote", q1, "approve", i.owner);
  assert.equal((await one("select status from quotes where id=$1", [q1])).status, "approved_for_sending");
  const report = await f.ap("fs_authority", "report", {}, i.owner);
  assert.deepEqual(report.approvals.filter(a => a.source_id === q1).map(a => [a.step, a.completes, a.role]).sort(), [[1, false, "sales_manager"], [2, true, "owner"]]);

  // Nobody approves their own entry under the matrix, the owner included.
  const own = await f.reviewQuote({ total: 20000, createdBy: i.owner });
  await assert.rejects(() => f.decide("quote", own, "approve", i.owner), /own entry/);

  // Delegation during leave: only the owner approves expenses; the owner delegates to accounts for a week. (The
  // built-in Rs 25,000 ceiling for accounts in transition_expense_approval still applies on top of the matrix.)
  await f.ap("fs_authority", "save_rule", { transaction_type: "expense", approver_roles: ["owner"], reason: "Owner approves all expenses" }, i.owner);
  const exp = await f.pendingExpense({ total: 20000 });
  await assert.rejects(() => f.decide("expense", exp, "approve", i.accounts), e => e.code === "NOT_LISTED");
  const d = await f.ap("fs_authority", "delegate", { from_user: i.owner, to_user: i.accounts, starts_on: istDay(0), ends_on: istDay(6), transaction_types: ["expense"], reason: "Owner travelling" }, i.admin)
    .catch(e => e);
  assert.match(String(d.message ?? ""), /Only the owner/, "an admin cannot hand out the owner's authority");
  const del = await f.ap("fs_authority", "delegate", { from_user: i.owner, to_user: i.accounts, starts_on: istDay(0), ends_on: istDay(6), transaction_types: ["expense"], reason: "Owner travelling" }, i.owner);
  await f.decide("expense", exp, "approve", i.accounts);
  assert.equal((await one("select approval_status from expense_ledger where id=$1", [exp])).approval_status, "approved");
  assert.equal((await f.ap("fs_authority", "report", {}, i.owner)).delegated_count, 1);
  await f.ap("fs_authority", "revoke_delegation", { id: del.id }, i.owner);
  const exp2 = await f.pendingExpense({ total: 8000 });
  await assert.rejects(() => f.decide("expense", exp2, "approve", i.accounts), e => e.code === "NOT_LISTED", "after revocation accounts no longer approves");
  await assert.rejects(() => f.raw("update authority_approvals set amount=0"), /cannot be changed/);
});

test("FS-75 a blank second-approver list saves, the second approval follows the second-approver roles, and enforced types use only inbox roles", async () => {
  // The screen sends JSON null for a blank list; that reads as "no second-approver roles", not an error.
  const blank = await f.ap("fs_authority", "save_rule", { transaction_type: "discount", min_amount: 0, max_amount: null, approver_roles: ["owner"], second_approver_from: null,
    second_approver_roles: null, reason: "Owner approves every discount" }, i.owner);
  assert.equal((await one("select second_approver_roles r from authority_rules where id=$1", [blank.id])).r, null);

  // First approver sales manager, second approver owner only.
  await f.ap("fs_authority", "save_rule", { transaction_type: "quote", min_amount: 0, max_amount: null, approver_roles: ["sales_manager"], second_approver_from: 100000,
    second_approver_roles: ["owner"], reason: "Sales manager first, owner second above 1 lakh" }, i.owner);
  const early = await f.reviewQuote({ total: 140000 });
  await assert.rejects(() => f.decide("quote", early, "approve", i.owner), /does not approve this amount/, "the owner gives the second approval, not the first");
  const q = await f.reviewQuote({ total: 150000 });
  await f.decide("quote", q, "approve", i.salesManager);
  assert.equal((await one("select status from quotes where id=$1", [q])).status, "internal_review");
  await assert.rejects(() => f.decide("quote", q, "approve", i.admin), e => e.code === "NOT_LISTED", "admin is in neither role set");
  await f.decide("quote", q, "approve", i.owner);
  assert.equal((await one("select status from quotes where id=$1", [q])).status, "approved_for_sending");
  const steps = (await f.ap("fs_authority", "report", {}, i.owner)).approvals.filter(a => a.source_id === q).map(a => [a.step, a.completes, a.role]).sort();
  assert.deepEqual(steps, [[1, false, "sales_manager"], [2, true, "owner"]]);

  // Quotation and expense approvals are decided in the approval inbox; roles that cannot open it are refused.
  await assert.rejects(() => f.ap("fs_authority", "save_rule", { transaction_type: "expense", approver_roles: ["quality"], reason: "Quality approves expenses" }, i.owner), /approval inbox/);
  await assert.rejects(() => f.ap("fs_authority", "save_rule", { transaction_type: "low_margin_quote", approver_roles: ["owner"], second_approver_from: 0,
    second_approver_roles: ["factory_manager"], reason: "Factory second" }, i.owner), /approval inbox/);
  await f.ap("fs_authority", "save_rule", { transaction_type: "stock_adjustment", approver_roles: ["inventory_manager"], reason: "Stores approve adjustments" }, i.owner);
  const prodRole = (await one("select role from app_users where id=$1", [i.production])).role;
  assert.ok(!["owner", "admin", "sales_manager", "accounts"].includes(prodRole));
  const leave = { from_user: i.owner, to_user: i.production, starts_on: istDay(0), ends_on: istDay(3), reason: "Owner travelling" };
  await assert.rejects(() => f.ap("fs_authority", "delegate", { ...leave, transaction_types: ["expense"] }, i.owner), /approval inbox/);
  await assert.rejects(() => f.ap("fs_authority", "delegate", leave, i.owner), /approval inbox/, "all types includes the enforced ones");
  assert.ok((await f.ap("fs_authority", "delegate", { ...leave, transaction_types: ["stock_adjustment"] }, i.owner)).id);
});
