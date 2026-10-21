// Synthetic HTTP fixtures for the real Next.js dashboard, never a production auth or database service.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getBusinessDateBoundaries } from "../lib/utils/business-date.ts";

const appOrigin = "http://127.0.0.1:3580";
const fixtureOrigin = "http://127.0.0.1:3581";
const companyId = "10000000-0000-0000-0000-000000000001";
const otherCompany = "10000000-0000-0000-0000-000000000002";
const id = (n) => `30000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const roles = ["production", "dispatch", "accounts", "sales", "quality", "inventory_manager", "owner", "viewer", "dealer_staff"];
const scenarios = ["populated", "empty", "error", "disabled", "snapshot_error"];
const today = getBusinessDateBoundaries().today;
const yesterday = getBusinessDateBoundaries(new Date(Date.now() - 86400000)).today;
const queries = [];

function tokenFor(role, scenario) {
  const payload = { sub: id(roles.indexOf(role) + 800), role: "authenticated", fixture_role: role, scenario, aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 7200, iat: Math.floor(Date.now() / 1000) };
  return `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.synthetic-fixture-signature`;
}

function authUser(payload) {
  return { id: payload.sub, aud: "authenticated", role: "authenticated", email: `${payload.fixture_role}@fixture.invalid`, app_metadata: { provider: "email" }, user_metadata: {}, created_at: "2026-10-21T00:00:00Z" };
}

function splitExpressions(value) {
  let depth = 0, start = 0;
  const result = [];
  for (let index = 0; index < value.length; index++) {
    if (value[index] === "(") depth++;
    if (value[index] === ")") depth--;
    if (value[index] === "," && depth === 0) { result.push(value.slice(start, index)); start = index + 1; }
  }
  result.push(value.slice(start));
  return result;
}

function matches(value, expression) {
  if (expression.startsWith("not.")) return !matches(value, expression.slice(4));
  const dot = expression.indexOf(".");
  const op = expression.slice(0, dot), expected = expression.slice(dot + 1);
  if (op === "is") return expected === "null" ? value == null : String(value) === expected;
  if (op === "eq") return String(value) === expected;
  if (op === "in") return expected.slice(1, -1).split(",").includes(String(value));
  if (op === "gt") return Number(value) > Number(expected);
  if (op === "lte") return Number(value) <= Number(expected);
  throw new Error(`Unsupported fixture filter: ${op}`);
}

function records(table, actor) {
  const base = { company_id: companyId, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-21T00:00:00Z", deleted_at: null, is_active: true };
  if (table === "app_users") return [{ ...base, id: actor.sub, role: actor.fixture_role, full_name: `Fixture ${actor.fixture_role.replaceAll("_", " ")}`, email: `${actor.fixture_role}@fixture.invalid`, dealer_id: actor.fixture_role === "dealer_staff" ? id(900) : null, companies: { name: "Synthetic factory - local inspection" } }];
  if (table === "feature_flags") return ["production_planning", "advanced_inventory", "quality_compliance"].map((module_name) => ({ ...base, module_name, is_enabled: actor.scenario !== "disabled" }));
  if (actor.scenario === "empty") return [];
  if (table === "tasks") return [
    ...Array.from({ length: 12 }, (_, index) => ({ ...base, id: id(index + 1), title: index === 0 ? "Run job PR-2026-101 - approved window section" : index === 1 ? "Resolve die hold for PR-2026-102 before resuming" : index === 2 ? "Confirm drawing revision for the customer-specific architectural-profile-with-a-long-identifying-code-6063-T6" : `Assigned follow-up ${index + 1}`, status: "open", priority: index < 2 ? "high" : "normal", due_date: index === 0 ? yesterday : index === 2 ? null : today, assigned_to: actor.sub, dealership_id: null, related_entity_type: index < 2 ? "production_job" : null, related_entity_id: index < 2 ? id(101 + index) : null })),
    ...[20, 21].map((n) => ({ ...base, id: id(n), title: `Unassigned factory reminder ${n - 19}`, status: "open", priority: "normal", due_date: today, assigned_to: null, dealership_id: null, related_entity_type: null, related_entity_id: null })),
    { ...base, id: id(22), title: "Restricted unassigned invoice follow-up", status: "open", assigned_to: null, dealership_id: null, related_entity_type: "invoice", related_entity_id: id(201), due_date: today },
    { ...base, id: id(30), title: "OTHER USER TASK MUST NOT APPEAR", status: "open", assigned_to: id(999), dealership_id: null, related_entity_type: null },
    { ...base, company_id: otherCompany, id: id(31), title: "OTHER COMPANY TASK MUST NOT APPEAR", status: "open", assigned_to: actor.sub, dealership_id: null },
    { ...base, id: id(32), title: "CLOSED TASK MUST NOT APPEAR", status: "completed", assigned_to: actor.sub, dealership_id: null },
  ];
  if (table === "production_jobs") return [101, 102, 103].map((n) => ({ ...base, id: id(n), job_number: `PR-2026-${n}`, status: n === 102 ? "on_hold" : "ready", planned_date: n === 101 ? yesterday : today, planned_quantity_kg: 480, actual_quantity_kg: 0, actual_pieces: null, actual_meters: null, pieces: 100, length_per_piece_m: 6, finishing_type: "mill_finish", order_id: id(501), profile_id: id(601), aluminium_profiles: { profile_code: "EOS-6063-W01", profile_name: "Window section" }, orders: { order_number: "ORD-2026-0501" }, machines: { machine_name: "Press 1" } }));
  if (table === "dispatches") return [{ ...base, id: id(401), dispatch_number: "DSP-2026-0401", delivery_status: "pending", dispatch_date: today }, { ...base, id: id(402), dispatch_number: "DSP-2026-0402", delivery_status: "delayed", dispatch_date: yesterday }];
  if (table === "invoices") return [{ ...base, id: id(201), invoice_number: "INV-2026-0201", status: "overdue", due_date: yesterday, balance_due: 1000, grand_total: 1000, amount_paid: 0, customer_credit_due: 0 }, { ...base, id: id(202), invoice_number: "INV-2026-0202", status: "sent", due_date: today, balance_due: 500, grand_total: 500, amount_paid: 0, customer_credit_due: 0 }];
  if (table === "quotes") return [{ ...base, id: id(301), quote_number: "QUO-2026-0301", status: "sent", valid_until: today }];
  if (table === "quality_inspections") return [{ ...base, id: id(701), batch_number: "QC-2026-0701", status: "rework", inspection_date: today }];
  if (table === "inventory_items") return [{ ...base, id: id(601), item_code: "BILLET-6063-178", item_name: "6063 billet", current_stock: 0 }];
  return [];
}

function snapshot(actor) {
  const value = { version: "20261008", asOf: today, generatedAt: new Date().toISOString(), unknownShipmentCount: 0, quoteRows: [], orderRows: [], delayedOrders: [], lowInventoryRows: [], orderStageDistribution: [], delayedOrderCount: 0 };
  for (const key of ["monthlyQuoteValue", "monthlyOrderValue", "monthlyQuoteCount", "monthlyOrderCount", "activeCustomerCount", "pendingQuoteCount", "productionCount", "todayJobCount", "pendingDispatchCount", "dispatchCount", "dieCorrectionCount", "qualityHoldCount", "lowInventoryCount"]) value[key] = actor.fixture_role === "owner" ? 0 : null;
  return value;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, fixtureOrigin);
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": appOrigin, "Access-Control-Allow-Headers": request.headers["access-control-request-headers"] ?? "authorization,apikey,content-type,x-client-info,prefer", "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS", "Access-Control-Expose-Headers": "Content-Range", "Cache-Control": "no-store" };
  const send = (status, data) => { response.writeHead(status, headers); response.end(request.method === "HEAD" ? undefined : JSON.stringify(data)); };
  if (request.method === "OPTIONS") return send(200, {});
  if (!["GET", "HEAD"].includes(request.method) && !url.pathname.startsWith("/rest/v1/rpc/")) return send(405, { message: "This synthetic fixture is read-only." });
  if (url.pathname === "/") {
    response.writeHead(200, { "Content-Type": "text/html" });
    return response.end(`<html><head><title>My Work Today local fixtures</title></head><body style="font:18px sans-serif;max-width:900px;margin:40px"><h1>Synthetic local inspection</h1><p>These links use synthetic sessions with the real Next.js application. No hosted data, credentials, or writes are used. This does not emulate PostgreSQL RLS.</p>${roles.map((role) => `<h2>${role}</h2>${scenarios.map((scenario) => `<a style="margin-right:20px;line-height:2" href="/session/${role}/${scenario}">${role} ${scenario}</a>`).join("")}`).join("")}<p><a href="/anonymous">Anonymous access check</a></p></body></html>`);
  }
  if (url.pathname === "/anonymous") {
    response.writeHead(302, { "Set-Cookie": "sb-127-auth-token=; Path=/; Max-Age=0; SameSite=Lax", Location: `${appOrigin}/dashboard` });
    return response.end();
  }
  if (url.pathname.startsWith("/session/")) {
    const [, , role, scenario] = url.pathname.split("/");
    assert.ok(roles.includes(role) && scenarios.includes(scenario));
    const access_token = tokenFor(role, scenario);
    const payload = JSON.parse(Buffer.from(access_token.split(".")[1], "base64url"));
    const session = { access_token, refresh_token: "synthetic-fixture-refresh", token_type: "bearer", expires_in: 7200, expires_at: payload.exp, user: authUser(payload) };
    response.writeHead(302, { "Set-Cookie": `sb-127-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}; Path=/; SameSite=Lax`, Location: `${appOrigin}/dashboard` });
    return response.end();
  }
  let actor;
  try { actor = JSON.parse(Buffer.from(request.headers.authorization.split(" ")[1].split(".")[1], "base64url")); }
  catch { return send(401, { message: "Synthetic session required" }); }
  if (!roles.includes(actor.fixture_role)) return send(401, { message: "Unknown fixture identity" });
  if (url.pathname === "/auth/v1/user") return send(200, authUser(actor));
  const table = url.pathname.split("/").at(-1);
  queries.push({ role: actor.fixture_role, scenario: actor.scenario, table, query: url.search });
  if (url.pathname.includes("/rpc/")) {
    if (table === "get_unread_notification_count") return send(200, 0);
    if (table === "get_dashboard_snapshot") return actor.scenario === "snapshot_error" ? send(503, { message: "Synthetic snapshot failure" }) : send(200, snapshot(actor));
    return send(405, { message: "Business mutations are disabled in this fixture." });
  }
  if (table === "production_jobs" && actor.scenario === "error") return send(403, { message: "Synthetic queue failure" });
  let rows = records(table, actor);
  try {
    for (const [field, expression] of url.searchParams) {
      if (["select", "order", "limit", "offset"].includes(field)) continue;
      if (field === "or") {
        const clauses = splitExpressions(expression.slice(1, -1));
        rows = rows.filter((row) => clauses.some((clause) => { const dot = clause.indexOf("."); return matches(row[clause.slice(0, dot)], clause.slice(dot + 1)); }));
      } else rows = rows.filter((row) => matches(row[field], expression));
    }
    const count = rows.length;
    const orders = (url.searchParams.get("order") ?? "").split(",").filter(Boolean);
    rows.sort((a, b) => {
      for (const ordering of orders) {
        const [field, direction, nulls] = ordering.split(".");
        if (a[field] == null && b[field] == null) continue;
        if (a[field] == null) return nulls === "nullsfirst" ? -1 : 1;
        if (b[field] == null) return nulls === "nullsfirst" ? 1 : -1;
        const compared = String(a[field]).localeCompare(String(b[field]));
        if (compared) return direction === "desc" ? -compared : compared;
      }
      return 0;
    });
    rows = rows.slice(Number(url.searchParams.get("offset") ?? 0), Number(url.searchParams.get("offset") ?? 0) + Number(url.searchParams.get("limit") ?? 1000));
    const selected = url.searchParams.get("select") ?? "*";
    if (!selected.includes("*")) rows = rows.map((row) => Object.fromEntries(splitExpressions(selected).map((field) => { const name = field.split("(")[0]; return [name, row[name] ?? null]; })));
    headers["Content-Range"] = `0-${Math.max(0, rows.length - 1)}/${count}`;
    if (request.headers.accept?.includes("application/vnd.pgrst.object+json")) return send(rows.length === 1 ? 200 : 406, rows[0] ?? { message: "Fixture record not found" });
    return send(200, rows);
  } catch (error) { return send(400, { message: error.message }); }
});

server.listen(3581, "127.0.0.1", () => {
  console.log(`Synthetic fixture chooser: ${fixtureOrigin}`);
  const child = spawn(process.execPath, [fileURLToPath(import.meta.resolve("next/dist/bin/next")), "dev", "--hostname", "127.0.0.1", "--port", "3580"], {
    stdio: "inherit", env: { ...process.env, NODE_ENV: "development", NEXT_DIST_DIR: ".next-my-work", NEXT_PUBLIC_SUPABASE_URL: fixtureOrigin,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "synthetic-fixture-only", NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-fixture-only", SUPABASE_SERVICE_ROLE_KEY: "",
      RESEND_API_KEY: "", EMAIL_WEBHOOK_URL: "", EMAIL_WEBHOOK_SECRET: "", NVIDIA_API_KEY: "" },
  });
  const close = () => { child.kill(); server.close(); };
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
  child.on("exit", (code) => { server.close(); process.exitCode = code ?? 1; });
  child.on("error", (error) => { console.error(error.message); server.close(); process.exitCode = 1; });
});
