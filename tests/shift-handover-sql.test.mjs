import test from "node:test";
import assert from "node:assert/strict";
import { createShiftHandoverFixture, sids, sid, WINDOW, at } from "../scripts/lib/shift-handover-fixture.mjs";

let f;
test.before(async () => { f = await createShiftHandoverFixture(); });
test.beforeEach(async () => { await f.reset(); });
test.after(async () => { await f?.close(); });

const preview = (window = WINDOW, actor) => f.command("handover.preview", { period_start: window.start, period_end: window.end }, actor);
const submit = (extra = {}, actor) => f.command("handover.submit", { period_start: WINDOW.start, period_end: WINDOW.end, shift_label: "Day shift", note: "Press 1 die change pending", request_id: sid(5000), ...extra }, actor);

// ---------- Summary content ----------

test("every open or window-completed job appears once with a single category, held first", async () => {
  const data = await preview();
  assert.deepEqual(data.jobs.map((job) => [job.job_number, job.category]), [["PJ-3", "held"], ["PJ-2", "running"], ["PJ-4", "ready"], ["PJ-1", "completed"]]);
  assert.equal(data.jobs_total, 4);
  const ids = data.jobs.map((job) => job.id);
  assert.equal(new Set(ids).size, ids.length, "no job is listed twice");
});

test("jobs completed before or after the window are excluded, other companies never appear", async () => {
  const numbers = (await preview()).jobs.map((job) => job.job_number);
  for (const excluded of ["PJ-0", "PJ-5", "FOREIGN"]) assert.ok(!numbers.includes(excluded), excluded);
});

test("held jobs carry their recorded hold reason, resume condition and responsible person", async () => {
  const held = (await preview()).jobs.find((job) => job.category === "held");
  assert.equal(held.hold_reason, "die_problem");
  assert.equal(held.hold_resume_condition, "Die DIE-12 corrected");
  assert.equal(held.hold_responsible, "Night Supervisor Raj");
});

test("outstanding kg is planned minus produced, never negative, and missing plan is not zero", async () => {
  const jobs = Object.fromEntries((await preview()).jobs.map((job) => [job.job_number, job]));
  assert.equal(Number(jobs["PJ-2"].outstanding_kg), 650);
  assert.equal(Number(jobs["PJ-3"].outstanding_kg), 500, "no output recorded yet counts as zero produced");
  assert.equal(jobs["PJ-4"].outstanding_kg, null, "no planned quantity means outstanding is unknown");
  assert.equal(jobs["PJ-1"].outstanding_kg, null, "completed jobs have nothing outstanding to hand over");
  await f.db.exec(`update production_jobs set actual_quantity_kg=1200 where id='${sids.jobRunning}'`);
  assert.equal(Number((await preview()).jobs.find((job) => job.job_number === "PJ-2").outstanding_kg), 0);
});

test("only exceptions recorded inside the window are counted against a job", async () => {
  const data = await preview();
  assert.equal(data.jobs.find((job) => job.job_number === "PJ-2").exceptions_in_window, 1);
  assert.equal(data.exceptions_total, 1);
  assert.equal(data.exceptions[0].reason, "material_shortage");
  assert.equal(data.exceptions[0].job_number, "PJ-2");
});

test("breakdowns overlapping the window are clipped to it, and an open one runs to the window end", async () => {
  const data = await preview();
  assert.equal(data.downtime_total, 2);
  const byIssue = Object.fromEntries(data.downtime.map((row) => [row.issue, row]));
  assert.equal(byIssue["Hydraulic leak"].minutes_in_window, 60, "started an hour before the window");
  assert.equal(byIssue["Hydraulic leak"].unresolved, false);
  assert.equal(byIssue["Puller fault"].minutes_in_window, 60, "still open at the window end");
  assert.equal(byIssue["Puller fault"].unresolved, true);
  assert.equal(byIssue["Puller fault"].machine_name, "Press 1");
  assert.ok(!byIssue["Before window"] && !byIssue["FOREIGN BREAKDOWN"]);
});

test("a resolved breakdown without an end time adds no downtime instead of running forever", async () => {
  await f.db.exec(`insert into breakdown_logs values('${sid(110)}','${sids.company}','legacy','${sids.press}','resolved','No end recorded','${at(-3)}',null,null),
    ('${sid(111)}','${sids.company}','legacy','${sids.press}','resolved','Zero length inside','${at(4)}',null,null)`);
  const data = await preview();
  const issues = data.downtime.map((row) => row.issue);
  assert.ok(!issues.includes("No end recorded"), "resolved before the window, unknown end: not carried into the shift");
  assert.equal(data.downtime.find((row) => row.issue === "Zero length inside").minutes_in_window, 0);
});

test("quality items list only open inspections in the window; stock holds count only unsent stock", async () => {
  const data = await preview();
  assert.deepEqual(data.quality.map((row) => [row.batch_number, row.status]), [["B-77", "rework"]]);
  assert.equal(data.stock_holds_count, 1);
  assert.equal(Number(data.stock_holds_kg), 120.5);
});

test("pending loads due by the shift's business date are listed and earlier ones are flagged overdue", async () => {
  const loads = (await preview()).pending_loads;
  assert.deepEqual(loads.map((load) => [load.dispatch_number, load.overdue]), [["D-0", true], ["D-1", false]]);
  assert.equal(loads[1].vehicle_number, "MH12AB1234");
});

test("lists are bounded at 100 rows and report the true total", async () => {
  const values = Array.from({ length: 105 }, (_, i) => `('${sid(2000 + i)}','${sids.company}','${sids.jobRunning}','other','n','x','${at(1 + i / 1000)}')`).join(",");
  await f.db.exec(`insert into production_exceptions values ${values}`);
  const data = await preview();
  assert.equal(data.exceptions.length, 100);
  assert.equal(data.exceptions_total, 106);
});

// ---------- Window validation ----------

test("invalid, reversed, over-long, stale and future windows are rejected", async () => {
  const bad = [
    { start: "not a date", end: WINDOW.end },
    { start: WINDOW.end, end: WINDOW.start },
    { start: WINDOW.start, end: WINDOW.start },
    { start: at(-13), end: at(12) },
    { start: at(-24 * 40), end: at(-24 * 40 + 8) },
    { start: new Date(Date.now() + 2 * 3600e3).toISOString(), end: new Date(Date.now() + 10 * 3600e3).toISOString() }
  ];
  for (const window of bad) await assert.rejects(preview(window), /shift/i, JSON.stringify(window));
});

// ---------- Submit, idempotency and snapshot ----------

test("submitting stores the server-built snapshot with the supervisor's note and name", async () => {
  const { id } = await submit();
  assert.equal(id, sid(5000));
  const row = (await f.db.query("select * from shift_handovers where id=$1", [id])).rows[0];
  assert.equal(row.prepared_by_name, "Day Supervisor Neha");
  assert.equal(row.note, "Press 1 die change pending");
  assert.equal(row.status, "submitted");
  assert.equal(row.summary.jobs.length, 4);
});

test("the stored snapshot does not change when production records change later", async () => {
  const { id } = await submit();
  await f.db.exec(`update production_jobs set status='completed', completed_at='${at(13)}' where id='${sids.jobHeld}'`);
  const loaded = await f.command("handover.load", { handover_id: id }, sids.viewer);
  assert.equal(loaded.summary.jobs.find((job) => job.job_number === "PJ-3").category, "held");
});

test("retrying the same request returns the same handover; reusing its id for other details is refused", async () => {
  await submit();
  assert.deepEqual(await submit(), { id: sid(5000) });
  assert.equal((await f.db.query("select count(*)::int n from shift_handovers")).rows[0].n, 1);
  await assert.rejects(submit({ note: "Different" }), /already used for different details/);
});

test("a second handover for the same or an overlapping window is refused; an adjacent shift is allowed", async () => {
  await submit();
  await assert.rejects(submit({ request_id: sid(5001) }), /overlapping this shift window/);
  const night = await f.command("handover.submit", { period_start: at(-12), period_end: at(0), shift_label: "Night", note: "", request_id: sid(5002) });
  assert.equal(night.id, sid(5002), "the previous night shift shares a boundary but is a different window");
  await assert.rejects(f.command("handover.submit", { period_start: at(-1), period_end: at(11), shift_label: "Overlap", note: "", request_id: sid(5004) }), /overlapping this shift window/);
});

test("label and note limits, control characters and missing request identity are rejected", async () => {
  await assert.rejects(submit({ shift_label: "  " }), /shift name/);
  await assert.rejects(submit({ shift_label: "x".repeat(41) }), /shift name/);
  await assert.rejects(submit({ shift_label: "Day\u0007" }), /shift name/);
  await assert.rejects(submit({ note: "n".repeat(2001) }), /2,000 characters/);
  await assert.rejects(submit({ request_id: null }), /request identity is required/);
});

// ---------- Acknowledgement ----------

test("a different supervisor acknowledges once; a retry by the same person with the same note is a no-op", async () => {
  const { id } = await submit();
  await f.command("handover.acknowledge", { handover_id: id, note: "Received, die change first" }, sids.incoming);
  const row = (await f.db.query("select status, acknowledged_by_name, acknowledgement_note from shift_handovers where id=$1", [id])).rows[0];
  assert.deepEqual(row, { status: "acknowledged", acknowledged_by_name: "Night Supervisor Raj", acknowledgement_note: "Received, die change first" });
  assert.deepEqual(await f.command("handover.acknowledge", { handover_id: id, note: "Received, die change first" }, sids.incoming), { id });
  await assert.rejects(f.command("handover.acknowledge", { handover_id: id, note: "changed" }, sids.incoming), /already acknowledged/);
});

test("the person who prepared the handover cannot acknowledge it", async () => {
  const { id } = await submit();
  await assert.rejects(f.command("handover.acknowledge", { handover_id: id, note: "" }), /incoming supervisor must acknowledge/);
});

// ---------- Roles and tenancy ----------

test("viewers can read but not submit or acknowledge; sales and dealer users have no access", async () => {
  const { id } = await submit();
  assert.equal((await f.command("handover.list", {}, sids.viewer)).total_count, 1);
  await assert.rejects(submit({ request_id: sid(5003) }, sids.viewer), /not permitted/);
  await assert.rejects(f.command("handover.acknowledge", { handover_id: id, note: "" }, sids.viewer), /not permitted/);
  for (const actor of [sids.sales, sids.dealer]) {
    await assert.rejects(preview(WINDOW, actor), /not permitted/);
    assert.deepEqual(await f.asUser("select id from shift_handovers", [], actor), [], "row security hides handovers");
  }
});

test("another company cannot list, load or acknowledge a handover, and its summary excludes our records", async () => {
  const { id } = await submit();
  assert.equal((await f.command("handover.list", {}, sids.foreign)).total_count, 0);
  await assert.rejects(f.command("handover.load", { handover_id: id }, sids.foreign), /unavailable/);
  await assert.rejects(f.command("handover.acknowledge", { handover_id: id, note: "" }, sids.foreign), /unavailable/);
  const theirs = await preview(WINDOW, sids.foreign);
  assert.deepEqual(theirs.jobs.map((job) => job.job_number), ["FOREIGN"]);
  assert.deepEqual(await f.asUser("select id from shift_handovers", [], sids.foreign), []);
});

test("anonymous callers and direct table writes are refused", async () => {
  await assert.rejects(f.asUser("select public.shift_handover_command('handover.list','{}'::jsonb)", [], ""), /Authentication required/);
  await assert.rejects(f.asUser(`insert into shift_handovers(id,company_id,period_start,period_end,shift_label,summary,prepared_by,prepared_by_name) values('${sid(6000)}','${sids.company}',now(),now()+interval '1 hour','x','{}','${sids.outgoing}','x')`), /permission denied/);
  await assert.rejects(f.asUser("select private.shift_handover_summary($1,$2,$3)", [sids.otherCompany, WINDOW.start, WINDOW.end]), /permission denied/);
});

test("the list is paged at 10 rows, newest first, with open-job counts and a status filter", async () => {
  for (let i = 0; i < 12; i++) {
    await f.command("handover.submit", { period_start: at(-i * 12 - 12), period_end: at(-i * 12), shift_label: `S${i}`, note: "", request_id: sid(7000 + i) });
  }
  const first = await f.command("handover.list", { page: 1 });
  assert.equal(first.total_count, 12);
  assert.equal(first.rows.length, 10);
  assert.equal(first.rows[0].shift_label, "S0");
  assert.equal(Number(first.rows[0].open_job_count), 2, "held + running");
  assert.equal((await f.command("handover.list", { page: 2 })).rows.length, 2);
  await f.command("handover.acknowledge", { handover_id: sid(7000), note: "" }, sids.incoming);
  assert.equal((await f.command("handover.list", { status: "acknowledged" })).total_count, 1);
  await assert.rejects(f.command("handover.list", { page: 0 }), /Invalid page/);
});

test("unknown commands and non-object payloads are refused", async () => {
  await assert.rejects(f.command("handover.delete", {}), /not permitted/);
  await assert.rejects(f.asUser("select public.shift_handover_command('handover.list','[]'::jsonb)"), /Invalid handover request/);
});
