import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canPlaceHolds, canReadHolds, holdCommandSchema, issueResolution, readinessResponseSchema, summariseReadiness } from "../lib/workflow/production-readiness.ts";

const id = "00000000-0000-4000-8000-000000000060";
const base = { job_status: "ready", start_issues: [], release_issues: [], resume_issues: [], hold: null };
const issue = (code, enforced = true) => ({ code, enforced, message: `${code} message` });

test("hold input requires material condition and resume condition, and a note for other reasons", () => {
  const valid = { command: "holds.place", job_id: id, reason: "die_problem", note: "", material_condition: "Die in press", resume_condition: "Die corrected", responsible_user_id: id, expected_status: "in_progress", request_id: id };
  assert.equal(holdCommandSchema.safeParse(valid).success, true);
  assert.equal(holdCommandSchema.safeParse({ ...valid, material_condition: "   " }).success, false);
  assert.equal(holdCommandSchema.safeParse({ ...valid, resume_condition: "" }).success, false);
  assert.equal(holdCommandSchema.safeParse({ ...valid, reason: "other" }).success, false);
  assert.equal(holdCommandSchema.safeParse({ ...valid, reason: "other", note: "Power cut" }).success, true);
  assert.equal(holdCommandSchema.safeParse({ ...valid, reason: "lunch" }).success, false);
  assert.equal(holdCommandSchema.safeParse({ ...valid, expected_status: "on_hold" }).success, false);
  assert.equal(holdCommandSchema.safeParse({ ...valid, company_id: id }).success, false, "forged company context is rejected");
  assert.equal(holdCommandSchema.safeParse({ ...valid, note: "bad\u0007bell" }).success, false);
  assert.equal(holdCommandSchema.safeParse({ ...valid, material_condition: "x".repeat(501) }).success, false);
  assert.equal(holdCommandSchema.safeParse({ command: "holds.resume", job_id: id, hold_id: id, note: " ", request_id: id }).success, false);
});

test("hold permissions match the database roles", () => {
  for (const role of ["owner", "admin", "factory_manager", "production_manager", "production"]) assert.equal(canPlaceHolds(role), true, role);
  for (const role of ["quality", "viewer", "sales", "dispatch", "dealer_admin"]) assert.equal(canPlaceHolds(role), false, role);
  assert.equal(canReadHolds("quality"), true);
  assert.equal(canReadHolds("viewer"), true);
  assert.equal(canReadHolds("sales"), false);
  assert.equal(canReadHolds("accounts"), false);
});

test("every enforced readiness issue links to where it is resolved", () => {
  const links = { jobId: id, orderId: "o1", dieId: "d1", machineId: "m1", profileId: "p1" };
  const expected = {
    die_missing: `/production/${id}/edit`, machine_missing: `/production/${id}/edit`, billet_ineligible: `/production/${id}/edit`,
    die_ineligible: "/dies/d1", die_busy: "/dies/d1", machine_ineligible: "/machines/m1", slot_missing: "/production/schedule",
    billets_not_issued: "#production-controls", order_ineligible: "/orders/o1", active_hold: "#production-hold", drawing_not_approved: "/profiles/p1"
  };
  for (const [code, href] of Object.entries(expected)) assert.equal(issueResolution(code, links)?.href, href, code);
  assert.equal(issueResolution("status_not_startable", links), null);
  assert.equal(issueResolution("die_ineligible", { jobId: id }).href, `/production/${id}/edit`);
  assert.equal(issueResolution("order_ineligible", { jobId: id }), null);
});

test("readiness summary uses the issues for the next permitted action and separates advisories", () => {
  const ready = summariseReadiness({ ...base, start_issues: [issue("drawing_not_approved", false)] });
  assert.deepEqual([ready.action, ready.ready, ready.blockers.length, ready.advisories.length], ["start", true, 0, 1]);
  const planned = summariseReadiness({ ...base, job_status: "planned", release_issues: [issue("slot_missing")], start_issues: [issue("ignored")] });
  assert.deepEqual([planned.action, planned.ready, planned.blockers[0].code], ["release", false, "slot_missing"]);
  const heldRecord = { id, reason: "quality_hold", note: "", material_condition: "x", resume_condition: "y", responsible_name: "A", previous_status: "in_progress", recorded_output_kg: 1, recorded_output_pieces: null, issued_billet_count: 0, issued_billet_kg: 0, held_by_name: "B", held_at: "2026-10-22" };
  const held = summariseReadiness({ ...base, job_status: "on_hold", hold: heldRecord, start_issues: [issue("active_hold")], resume_issues: [issue("billet_ineligible")] });
  assert.deepEqual([held.action, held.ready, held.blockers.map((entry) => entry.code)], ["resume", false, ["billet_ineligible"]]);
  const done = summariseReadiness({ ...base, job_status: "completed" });
  assert.deepEqual([done.action, done.ready], [null, false]);
});

test("the readiness response schema rejects unexpected fields and accepts numeric strings for kg", () => {
  const hold = { id, reason: "quality_hold", note: "", material_condition: "x", resume_condition: "y", responsible_name: "A", previous_status: "ready", recorded_output_kg: "12.500", recorded_output_pieces: 3, issued_billet_count: 1, issued_billet_kg: "25.000", held_by_name: "B", held_at: "2026-10-22T10:00:00Z" };
  const parsed = readinessResponseSchema.parse({ ...base, hold });
  assert.equal(parsed.hold.recorded_output_kg, 12.5);
  assert.equal(readinessResponseSchema.safeParse({ ...base, extra: true }).success, false);
  assert.equal(readinessResponseSchema.safeParse({ ...base, start_issues: [{ ...issue("x"), cost: 1 }] }).success, false);
});

test("the floor workflow no longer offers transitions the database always rejects", () => {
  const source = readFileSync("components/modules/production-output-workflow.tsx", "utf8");
  assert.doesNotMatch(source, /moveStatus\("ready"\)/);
  assert.doesNotMatch(source, /moveStatus\("on_hold"\)/);
  assert.match(source, /href="\/production\/schedule"/);
  assert.match(source, /href="#production-hold"/);
});
