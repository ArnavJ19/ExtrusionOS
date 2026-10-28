import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  canReadHandover, canSubmitHandover, formatIst, handoverCommandSchema, handoverListSchema, handoverRecordSchema, handoverSummarySchema,
  handoverWhatsAppText, istLocalToIso, recentShiftWindows, summariseHandover, windowProblem
} from "../lib/workflow/shift-handover.ts";
import { createShiftHandoverFixture, sids, sid, WINDOW } from "../scripts/lib/shift-handover-fixture.mjs";

const H = 3_600_000;
const id = "00000000-0000-4000-8000-000000000060";

test("roles: production supervisors submit; quality, dispatch and viewers read; sales and dealers do neither", () => {
  for (const role of ["owner", "admin", "factory_manager", "production_manager", "production"]) assert.ok(canSubmitHandover(role) && canReadHandover(role), role);
  for (const role of ["quality", "dispatch_manager", "viewer"]) assert.ok(!canSubmitHandover(role) && canReadHandover(role), role);
  for (const role of ["sales", "accounts", "dealer_admin", "dealer_staff", "dispatch"]) assert.ok(!canReadHandover(role), role);
});

test("window rule matches the server: reversed, over 24 h, stale, not yet ended and unparseable windows", () => {
  const now = Date.parse("2026-10-22T15:00:00Z");
  const at = (h) => new Date(now + h * H).toISOString();
  assert.equal(windowProblem(at(-12), at(0), now), null);
  assert.equal(windowProblem(at(-12), at(0.9), now), null, "may prepare up to an hour before the end");
  assert.match(windowProblem(at(-12), at(1.5), now), /not ended/);
  assert.match(windowProblem(at(0), at(-1), now), /end after it starts/);
  assert.match(windowProblem(at(0), at(0), now), /end after it starts/);
  assert.match(windowProblem(at(-25), at(-0.5), now), /at most 24 hours/);
  assert.equal(windowProblem(at(-24), at(0), now), null, "exactly 24 hours is allowed");
  assert.match(windowProblem(at(-24 * 32), at(-24 * 32 + 8), now), /last 31 days/);
  assert.match(windowProblem("yesterday", at(0), now), /valid shift start/);
});

test("command schema rejects forged context, unknown commands and bad text, and validates windows", () => {
  const submit = { command: "handover.submit", period_start: WINDOW.start, period_end: WINDOW.end, shift_label: "Day", note: "", request_id: id };
  assert.equal(handoverCommandSchema.safeParse(submit).success, true);
  assert.equal(handoverCommandSchema.safeParse({ ...submit, company_id: id }).success, false);
  assert.equal(handoverCommandSchema.safeParse({ ...submit, shift_label: " " }).success, false);
  assert.equal(handoverCommandSchema.safeParse({ ...submit, shift_label: "x".repeat(41) }).success, false);
  assert.equal(handoverCommandSchema.safeParse({ ...submit, note: "a\u0000b" }).success, false);
  assert.equal(handoverCommandSchema.safeParse({ ...submit, period_end: submit.period_start }).success, false);
  assert.equal(handoverCommandSchema.safeParse({ ...submit, request_id: "1" }).success, false);
  assert.equal(handoverCommandSchema.safeParse({ command: "handover.delete", handover_id: id }).success, false);
  assert.equal(handoverCommandSchema.safeParse({ command: "handover.list", status: "deleted" }).success, false);
  assert.deepEqual(handoverCommandSchema.parse({ command: "handover.list" }), { command: "handover.list", page: 1 });
});

test("recent shift presets are the three latest 12-hour shifts on IST 08:00/20:00 boundaries", () => {
  // 22 Oct 2026 21:10 IST = 15:40 UTC: the day shift has ended, the night shift is running.
  const windows = recentShiftWindows(Date.parse("2026-10-22T15:40:00Z"));
  assert.deepEqual(windows.map((w) => [w.start, w.end]), [
    ["2026-10-22T02:30:00.000Z", "2026-10-22T14:30:00.000Z"],
    ["2026-10-21T14:30:00.000Z", "2026-10-22T02:30:00.000Z"],
    ["2026-10-21T02:30:00.000Z", "2026-10-21T14:30:00.000Z"]
  ]);
  assert.equal(windows[0].label, "Day shift, 22 Oct (08:00–20:00)");
  assert.equal(windows[1].label, "Night shift, 21–22 Oct (20:00–08:00)");
  // 19:30 IST: the day shift ends within the hour, so it is offered first.
  assert.equal(recentShiftWindows(Date.parse("2026-10-22T14:00:00Z"))[0].end, "2026-10-22T14:30:00.000Z");
  // Just after midnight UTC (05:40 IST) the current night shift ends at 08:00 IST, more than an hour away.
  assert.equal(recentShiftWindows(Date.parse("2026-10-23T00:10:00Z"))[0].end, "2026-10-22T14:30:00.000Z");
  for (const w of windows) assert.equal(windowProblem(w.start, w.end, Date.parse("2026-10-22T15:40:00Z")), null);
});

test("IST entry converts to the right instant and rejects impossible dates", () => {
  assert.equal(istLocalToIso("2026-10-22T08:00"), "2026-10-22T02:30:00.000Z");
  assert.equal(istLocalToIso("2026-10-23T00:15"), "2026-10-22T18:45:00.000Z");
  assert.equal(istLocalToIso("2026-02-30T08:00"), null);
  assert.equal(istLocalToIso("2026-10-22T24:00"), null);
  assert.equal(istLocalToIso("22/10/2026 08:00"), null);
  assert.equal(formatIst("2026-10-22T14:30:00Z"), "22 Oct 2026, 20:00");
  assert.equal(formatIst(null), "-");
  assert.equal(formatIst("garbage"), "-");
});

// Contract: the real database output parses with the schemas the app uses.
let f;
test.before(async () => { f = await createShiftHandoverFixture(); await f.reset(); });
test.after(async () => { await f?.close(); });

test("the database preview, stored record and list parse with the app's schemas", async () => {
  const preview = handoverSummarySchema.parse(await f.command("handover.preview", { period_start: WINDOW.start, period_end: WINDOW.end }));
  assert.equal(preview.jobs.length, 4);
  const { id: handoverId } = await f.command("handover.submit", { period_start: WINDOW.start, period_end: WINDOW.end, shift_label: "Day shift", note: "Run PJ-3 first", request_id: sid(9000) });
  const record = handoverRecordSchema.parse(await f.command("handover.load", { handover_id: handoverId }));
  assert.equal(record.prepared_by, sids.outgoing);
  const list = handoverListSchema.parse(await f.command("handover.list", {}));
  assert.equal(list.rows[0].open_job_count, 2);
});

test("summary headline totals and the WhatsApp text reflect the stored snapshot", async () => {
  await f.reset();
  const summary = handoverSummarySchema.parse(await f.command("handover.preview", { period_start: WINDOW.start, period_end: WINDOW.end }));
  const s = summariseHandover(summary);
  assert.deepEqual(s.byCategory, { held: 1, running: 1, ready: 1, completed: 1 });
  assert.equal(s.completedKg, 880);
  assert.equal(s.outstandingKg, 1150, "650 running + 500 held; the unplanned ready job is counted separately");
  assert.equal(s.outstandingUnknown, 1);
  assert.equal(s.downtimeMinutes, 120);
  assert.equal(s.unresolvedBreakdowns, 1);
  assert.equal(s.overdueLoads, 1);
  assert.equal(s.truncated, false);
  const text = handoverWhatsAppText({ shift_label: "Day shift", period_start: WINDOW.start, period_end: WINDOW.end, summary, note: "Run PJ-3 first", prepared_by_name: "Neha" });
  assert.match(text, /\*Shift handover: Day shift\*/);
  assert.match(text, /1 completed \(880\.0 kg\), 1 running, 1 on hold, 1 ready/);
  assert.match(text, /HOLD PJ-3: die problem; resume when Die DIE-12 corrected/);
  assert.match(text, /Loads pending: 2 \(1 overdue\)/);
  assert.match(text, /Note: Run PJ-3 first/);
  assert.doesNotMatch(text, /longer than shown/);
  assert.equal(summariseHandover({ ...summary, exceptions_total: 500 }).truncated, true);
});

test("pages and action stay wired: role gates, dealer exclusion and the route rule", () => {
  const action = readFileSync("lib/actions/shift-handover.ts", "utf8");
  assert.match(action, /context\.dealerId \|\| !\(mutation \? canSubmitHandover\(context\.role\) : canReadHandover\(context\.role\)\)/);
  assert.doesNotMatch(action, /company_id/, "company comes from the session in the database, never from input");
  for (const page of ["app/(dashboard)/production/handover/page.tsx", "app/(dashboard)/production/handover/[id]/page.tsx"]) {
    assert.match(readFileSync(page, "utf8"), /context\.dealerId \|\| !canReadHandover\(context\.role\)/, page);
  }
  assert.match(readFileSync("app/(dashboard)/production/handover/new/page.tsx", "utf8"), /canSubmitHandover/);
  assert.match(readFileSync("lib/auth/route-permissions.ts", "utf8"), /prefix: "\/production\/handover", roles: \[[^\]]*"quality", "dispatch_manager"/);
});
