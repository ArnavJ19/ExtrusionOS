import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { freshness, kgText, pct, slackText, tonnes, whatsappShareUrl } from "../lib/intelligence/format.ts";
import { DELAY_CAUSES, DEVELOPMENT_ORDER, INTELLIGENCE_COMMANDS, INTELLIGENCE_PATHS, INTELLIGENCE_READS, causeLabel, developmentCommands, exposureCommands, mrpCommands, otifCommands } from "../lib/intelligence/commands.ts";
import { PLAN_DESTINATIONS, planDestinationsFor } from "../lib/intelligence/destinations.ts";
import { hasRouteAccess } from "../lib/auth/route-permissions.ts";
import { JOBS } from "../lib/jobs/registry.ts";
import { cashForecastCommands } from "../lib/autopilot-batch9/commands.ts";

test("Phase 4 formatting keeps blanks blank and rounds as stated", () => {
  assert.equal(tonnes(12345), "12.3 t");
  assert.equal(tonnes(null), "—");
  assert.equal(tonnes(""), "—");
  assert.equal(kgText(123456.6), "1,23,457 kg", "Indian grouping, whole kg");
  assert.equal(pct(null), "—");
  assert.equal(pct(66.7), "66.7%");
  assert.equal(freshness(null, 0), "not yet");
  assert.equal(freshness(0, 30_000), "just now");
  assert.equal(freshness(0, 5 * 60_000), "5 min ago");
  assert.equal(freshness(0, 2 * 3600_000), "2 h ago");
  assert.equal(slackText(1), "1 day of slack");
  assert.equal(slackText(-2), "2 days past the promise");
  assert.equal(slackText(null), "No promise date");
  const url = whatsappShareUrl("Brief: 12 t & ₹5");
  assert.ok(url.startsWith("https://wa.me/?text="));
  assert.equal(decodeURIComponent(url.split("text=")[1]), "Brief: 12 t & ₹5");
});

test("Phase 4 command schemas refuse malformed input before the database", () => {
  assert.equal(otifCommands.save_settings.safeParse({ in_full_tolerance_percent: 11, reason: "Owner" }).success, false);
  assert.equal(otifCommands.save_settings.safeParse({ in_full_tolerance_percent: 2, reason: "Owner decision" }).success, true);
  assert.equal(otifCommands.set_cause.safeParse({ order_item_id: crypto.randomUUID(), cause: "weather" }).success, false);
  assert.equal(otifCommands.lines.safeParse({ extra: 1 }).success, false, "strict");
  assert.equal(exposureCommands.book.safeParse({ order_id: crypto.randomUUID(), supplier_reference: "PO-1", quantity_kg: 0, rate_per_kg: 240 }).success, false);
  assert.equal(mrpCommands.action.safeParse({ plan_id: crypto.randomUUID(), line_key: "billet:6063:7", action: "po_raised" }).success, false, "a purchase order needs its reference");
  assert.equal(mrpCommands.action.safeParse({ plan_id: crypto.randomUUID(), line_key: "billet:6063:7", action: "not_needed", note: "Stock arrived" }).success, true);
  assert.equal(developmentCommands.move.safeParse({ id: crypto.randomUUID(), to_stage: "shipped", note: "x y z" }).success, false);
  assert.equal(cashForecastCommands.forecast.safeParse({ weeks: 13 }).success, true);
  assert.equal(cashForecastCommands.forecast.safeParse({ weeks: 14 }).success, false);
  assert.equal(causeLabel("not_recorded"), "Not recorded");
  assert.equal(Object.keys(DELAY_CAUSES).length, 10);
  assert.deepEqual(DEVELOPMENT_ORDER.at(0), "enquiry");
  assert.deepEqual(DEVELOPMENT_ORDER.at(-1), "released");
});

test("Every Phase 4 gateway has a revalidation entry and every read command is classed as a read", () => {
  for (const gateway of Object.keys(INTELLIGENCE_COMMANDS)) assert.ok(gateway in INTELLIGENCE_PATHS, gateway);
  for (const read of ["summary", "position", "plan", "dies", "today", "board"]) assert.ok(INTELLIGENCE_READS.has(read));
  for (const write of ["set_cause", "book", "approve", "action", "move", "create", "save_settings"]) assert.ok(!INTELLIGENCE_READS.has(write), write);
});

test("Phase 4 routes admit the same roles as their destinations and their database gateways", () => {
  for (const d of PLAN_DESTINATIONS) {
    for (const role of d.roles) assert.equal(hasRouteAccess(d.href, role), true, `${role} ${d.href}`);
  }
  assert.equal(hasRouteAccess("/insights/cockpit", "accounts"), false);
  assert.equal(hasRouteAccess("/insights/otif", "factory_manager"), true, "a longer prefix opens OTIF beyond the Insights roles");
  assert.equal(hasRouteAccess("/insights/metal-exposure", "sales_manager"), false);
  assert.equal(hasRouteAccess("/dies/life", "accounts"), true);
  assert.equal(hasRouteAccess("/production/material-plan", "production"), false);
  assert.equal(hasRouteAccess("/profiles/development/abc", "dispatch"), false);
  assert.deepEqual(planDestinationsFor("dealer_admin"), []);
  assert.ok(planDestinationsFor("owner").length === PLAN_DESTINATIONS.length);
});

test("The morning intelligence job is registered on both sides and the gateways guard roles in SQL", () => {
  assert.ok(JOBS.some(j => j.job_key === "intelligence.morning" && j.schedule === "morning"));
  const sql = ["20261118100000_fs_phase4_promises_otif.sql", "20261118110000_fs_phase4_finance_outlook.sql", "20261118120000_fs_phase4_planning_cockpit.sql"]
    .map(name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8")).join("\n");
  for (const gateway of [...Object.keys(INTELLIGENCE_COMMANDS), "ap_cash_forecast"]) {
    const body = sql.slice(sql.indexOf(`create or replace function public.${gateway}(`));
    assert.ok(body.length > 0, gateway);
    assert.match(body.slice(0, 2000), /private\.ap_ctx\(array\[/, `${gateway} takes the company and role from the session`);
    assert.match(sql, new RegExp(`revoke all on function public\\.${gateway}\\(text, jsonb\\) from public, anon;`));
  }
  // New tables are reached only through the gateways.
  for (const table of ["order_line_first_promises", "order_promise_changes", "metal_bookings", "mrp_weekly_plans", "development_projects", "development_events", "die_life_settings"]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`), table);
  }
  assert.doesNotMatch(sql, /grant (select|insert|update|delete)[^;]* to authenticated/i, "no direct table grants");
});
