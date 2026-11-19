import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { businessDateOf, businessShift, businessToday, financialYearOf } from "../lib/utils/business-date.ts";
import { compareWeights, invoiceKg, roundHalfAway, theoreticalKg } from "../lib/calculations/weight-basis.ts";
import { isSameOriginRequest } from "../lib/security/origin.ts";
import { hasRouteAccess } from "../lib/auth/route-permissions.ts";
import { BATCH4_COMMANDS, BATCH4_PATHS, BATCH4_READS, HISTORY_ENTITIES, KPI_READERS, authorityCommands, weightCommands } from "../lib/fs-batch4/commands.ts";
import { METRICS, METRIC_KEYS } from "../lib/insights/metrics.ts";

// FABLE_SUGGESTIONS batch 4: the TypeScript halves and the static contracts (FS-82, 65, 51, 77, 132, 79, 75, 07).
const read = file => readFileSync(file, "utf8");
const sql = ["20261119100000_fs_batch4_business_date.sql", "20261119110000_fs_batch4_kpi_dictionary.sql", "20261119120000_fs_batch4_die_health.sql",
  "20261119130000_fs_batch4_history_monitoring_security.sql", "20261119140000_fs_batch4_weight_basis_authority.sql"].map(f => read(`supabase/migrations/${f}`)).join("\n");

test("FS-82 the TypeScript business date is the India date, the night shift keeps its start date, and the financial year runs April to March", () => {
  assert.equal(businessToday(new Date("2026-11-18T19:00:00Z")), "2026-11-19", "00:30 IST is already the 19th");
  assert.equal(businessToday(new Date("2026-11-18T18:29:00Z")), "2026-11-18");
  assert.equal(businessDateOf("2026-03-31T18:30:00Z"), "2026-04-01", "midnight IST on 1 April");
  assert.equal(businessDateOf(null), null);
  assert.deepEqual(businessShift(new Date("2026-11-18T21:30:00Z")), { code: "C", shiftDate: "2026-11-18" }, "03:00 IST belongs to the C shift of the 18th");
  assert.deepEqual(businessShift(new Date("2026-11-19T00:30:00Z")), { code: "A", shiftDate: "2026-11-19" });
  assert.deepEqual(businessShift(new Date("2026-11-19T08:30:00Z")), { code: "B", shiftDate: "2026-11-19" }, "14:00 IST");
  assert.deepEqual(financialYearOf("2027-03-31"), { startYear: 2026, label: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31" });
  assert.equal(financialYearOf("2027-04-01").label, "2027-28");
  assert.equal(financialYearOf("2099-12-31").label, "2099-00");
});

test("FS-82 no application file computes today as the UTC date, and no later migration reintroduces current_date", () => {
  const offenders = [];
  const walk = dir => { for (const name of readdirSync(dir)) { const p = join(dir, name); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(name) && p !== join("lib", "utils", "business-date.ts")) {
    const text = read(p); if (/new Date\(\)\.toISOString\(\)\.(slice\(0, ?10\)|split\("T"\)\[0\]|substring\(0, ?10\))/.test(text)) offenders.push(p);
  } } };
  for (const dir of ["app", "lib", "components"]) walk(dir);
  assert.deepEqual(offenders, [], "use businessToday() from lib/utils/business-date");
  const later = readdirSync("supabase/migrations").filter(n => n > "20261119100000_fs_batch4_business_date.sql" && n.endsWith(".sql"));
  for (const name of later) {
    const body = read(`supabase/migrations/${name}`).replace(/--.*$/gm, "");
    assert.doesNotMatch(body, /\bcurrent_date\b/i, `${name}: use private.business_today()`);
  }
});

test("FS-65 the TypeScript weight comparison equals private.weight_compare on the same cases", () => {
  assert.equal(theoreticalKg(10, 6, 0.95), 57);
  assert.equal(theoreticalKg(10, 6, null), null);
  const a = compareWeights({ pieces: 10, lengthM: 6, kgPerM: 0.95, actualKg: 58.2, tolerancePercent: 2 });
  assert.deepEqual([a.theoreticalKg, a.actualKg, a.differenceKg, a.differencePercent, a.state], [57, 58.2, 1.2, 2.11, "heavy"]);
  assert.equal(compareWeights({ pieces: 10, lengthM: 6, kgPerM: 0.95, actualKg: 58.2, tolerancePercent: 2.5 }).state, "within");
  assert.equal(compareWeights({ pieces: 10, lengthM: 6, kgPerM: 0.95, actualKg: 55.9, tolerancePercent: null }).state, "no_tolerance");
  assert.equal(compareWeights({ pieces: 10, lengthM: 6, kgPerM: 0.95, actualKg: 0, tolerancePercent: 1 }).state, "not_weighed");
  assert.equal(compareWeights({ pieces: 10, lengthM: 6, kgPerM: 0.95, actualKg: 55.9, tolerancePercent: 1 }).state, "light", "-1.93% beyond 1%");
  assert.equal(roundHalfAway(1.0005, 3), 1.001, "half away from zero, no float drift");
  assert.equal(roundHalfAway(-1.0005, 3), -1.001);
  assert.equal(invoiceKg(null, 58.2, 57), null, "undecided basis never defaults silently");
  assert.equal(invoiceKg("theoretical", 58.2, 57), 57);
  assert.equal(invoiceKg("actual_weighed", 58.2, 57), 58.2);
  assert.match(sql, /round\(p_pieces \* p_length_m \* p_kg_per_m, 3\)/);
  assert.match(sql, /stock_basis text not null default 'actual_kg' check \(stock_basis = 'actual_kg'\)/);
  assert.equal(weightCommands.save_policy.safeParse({ invoice_basis: "theoretical", default_tolerance_percent: 30, reason: "Owner decision" }).success, false);
});

test("FS-51 a state-changing API request from another site is refused; same-site and server-to-server requests pass", () => {
  const h = o => new Headers(o);
  assert.equal(isSameOriginRequest({ method: "POST", headers: h({ origin: "https://erp.omalco.in", host: "erp.omalco.in" }), host: "erp.omalco.in" }), true);
  assert.equal(isSameOriginRequest({ method: "POST", headers: h({ origin: "https://evil.example", host: "erp.omalco.in" }), host: "erp.omalco.in" }), false);
  assert.equal(isSameOriginRequest({ method: "DELETE", headers: h({ "sec-fetch-site": "cross-site" }), host: "erp.omalco.in" }), false);
  assert.equal(isSameOriginRequest({ method: "POST", headers: h({}), host: "erp.omalco.in" }), true, "no browser headers: the route's session check decides");
  assert.equal(isSameOriginRequest({ method: "GET", headers: h({ origin: "https://evil.example" }), host: "erp.omalco.in" }), true, "reads are not blocked");
  assert.equal(isSameOriginRequest({ method: "POST", headers: h({ origin: "not a url" }), host: "erp.omalco.in" }), false);
  const proxy = read("proxy.ts");
  assert.match(proxy, /isSameOriginRequest\(/);
  for (const prefix of ["/api/pdf", "/api/reports", "/api/health"]) assert.ok(proxy.includes(`prefix: "${prefix}"`), prefix);
  const signIn = read("lib/actions/sign-in.ts");
  assert.match(signIn, /^"use server";/);
  assert.match(signIn, /fs_security_service", \{ p_command: "check"/);
  assert.match(signIn, /fs_security_service", \{ p_command: "failed"/);
  assert.doesNotMatch(read("components/modules/auth-forms.tsx"), /signInWithPassword/, "the browser no longer signs in directly");
});

test("FS-77/FS-132 every dictionary KPI the database computes names its key, and Command Center reads only fs_kpi for KPI figures", () => {
  const keys = METRIC_KEYS.map(k => METRICS[k].kpiKey).filter(Boolean);
  for (const key of keys) assert.match(sql, new RegExp(`'${key}', `), `${key} is returned by private.kpi_values`);
  assert.ok(keys.length >= 20);
  const page = read("app/(dashboard)/command-center/page.tsx");
  assert.match(page, /rpc\("fs_kpi"/);
  assert.doesNotMatch(page, /reduce\([^)]*(balance_due|weight_kg|actual_quantity_kg|amount)\b/, "no KPI sums on the page");
  assert.deepEqual([...KPI_READERS].sort(), ["accounts", "admin", "dispatch_manager", "factory_manager", "owner", "production_manager", "quality", "sales_manager"]);
  for (const role of KPI_READERS) assert.equal(hasRouteAccess("/insights/kpis", role), true, role);
  assert.equal(hasRouteAccess("/insights/kpis", "production"), false);
});

test("FS-79 every record type with a history tab is mounted on its detail page and listed in the database registry", () => {
  const pages = { order: "orders", quote: "quotes", invoice: "invoices", payment: "payments", dispatch: "dispatches", inventory_item: "inventory", die: "dies",
    customer: "customers", profile: "profiles", production_job: "production", vendor: "vendors", machine: "machines" };
  assert.deepEqual(Object.keys(pages).sort(), Object.keys(HISTORY_ENTITIES).sort());
  for (const [entity, dir] of Object.entries(pages)) {
    assert.match(read(`app/(dashboard)/${dir}/[id]/page.tsx`), new RegExp(`<RecordHistory entityType="${entity}"`), dir);
    assert.match(sql, new RegExp(`\\('${entity}', '${HISTORY_ENTITIES[entity]}'`), `${entity} in private.fs_history_entity`);
  }
});

test("FS-75 and the gateways: schemas refuse malformed input before the database; every gateway has paths and reads are classed", () => {
  assert.equal(authorityCommands.save_rule.safeParse({ transaction_type: "quote", min_amount: 100, max_amount: 50, approver_roles: ["owner"], second_approver_from: null, second_approver_roles: null, reason: "Policy" }).success, false);
  assert.equal(authorityCommands.save_rule.safeParse({ transaction_type: "quote", min_amount: 0, max_amount: null, approver_roles: [], second_approver_from: null, second_approver_roles: null, reason: "Policy" }).success, false);
  assert.equal(authorityCommands.save_rule.safeParse({ transaction_type: "quote", min_amount: 0, max_amount: 1000, approver_roles: ["owner"], second_approver_from: 2000, second_approver_roles: null, reason: "Policy" }).success, false, "second approver amount outside the band");
  assert.equal(authorityCommands.save_rule.safeParse({ transaction_type: "expense", min_amount: 0, max_amount: null, approver_roles: ["owner"], second_approver_from: 100000, second_approver_roles: ["admin"], reason: "Owner policy" }).success, true);
  assert.equal(authorityCommands.delegate.safeParse({ from_user: crypto.randomUUID(), to_user: crypto.randomUUID(), starts_on: "2026-11-20", ends_on: "2026-11-19", reason: "Leave" }).success, false);
  for (const gateway of Object.keys(BATCH4_COMMANDS)) assert.ok(gateway in BATCH4_PATHS, gateway);
  for (const r of ["values", "record", "health", "policy", "overview", "report", "awaiting"]) assert.ok(BATCH4_READS.has(r), r);
  for (const w of ["save_policy", "save_customer", "save_rule", "retire_rule", "delegate", "revoke_delegation"]) assert.ok(!BATCH4_READS.has(w), w);
  assert.match(sql, /create trigger zz_fs_authority_quote before update of status on public\.quotes/);
  assert.match(sql, /'Nobody approves their own entry\.'/);
});

test("FS-07 and FS-51 database functions are not callable by the public, and service functions only by the service role", () => {
  for (const fn of ["fs_kpi(text, jsonb)", "fs_history(text, jsonb)", "fs_monitoring(text, jsonb)", "fs_security(text, jsonb)", "fs_weight_basis(text, jsonb)", "fs_authority(text, jsonb)"]) {
    assert.ok(sql.includes(`revoke all on function public.${fn} from public, anon;`), fn);
    assert.ok(sql.includes(`grant execute on function public.${fn} to authenticated;`), fn);
  }
  for (const fn of ["fs_monitoring_service(text, jsonb)", "fs_security_service(text, jsonb)"]) {
    assert.ok(sql.includes(`revoke all on function public.${fn} from public, anon, authenticated;`), fn);
    assert.ok(sql.includes(`grant execute on function public.${fn} to service_role;`), fn);
  }
  assert.match(sql, /revoke all on public\.app_error_events from public, anon, authenticated;/);
  assert.match(sql, /revoke insert, update, delete, truncate on public\.die_health_metrics from public, anon, authenticated;/);
  assert.match(read("instrumentation.ts"), /export async function onRequestError/);
  assert.match(read("app/(dashboard)/layout.tsx"), /<ErrorReporter \/>/);
  assert.match(read("app/api/health/route.ts"), /HEALTH_CHECK_TOKEN/);
});
