// Synthetic HTTP fixtures for the real Next.js dashboard, never a production auth or database service.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { getBusinessDateBoundaries } from "../lib/utils/business-date.ts";

const appOrigin = "http://127.0.0.1:3580";
const fixtureOrigin = "http://127.0.0.1:3581";
const companyId = "10000000-0000-0000-0000-000000000001";
const otherCompany = "10000000-0000-0000-0000-000000000002";
const id = (n) => `30000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const roles = ["production", "dispatch", "accounts", "sales", "quality", "inventory_manager", "owner", "viewer", "dealer_staff"];
const scenarios = ["populated", "empty", "error", "disabled", "snapshot_error", "other_company", "other_user"];
const today = getBusinessDateBoundaries().today;
const yesterday = getBusinessDateBoundaries(new Date(Date.now() - 86400000)).today;
const queries = [];
const draftWrites = [];
const savedQuotes = [];

function tokenFor(role, scenario) {
  const payload = { sub: id(roles.indexOf(role) + (scenario === "other_user" ? 1800 : 800)), company: scenario === "other_company" ? otherCompany : companyId, role: "authenticated", fixture_role: role, scenario, aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 7200, iat: Math.floor(Date.now() / 1000) };
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
  if (op === "ilike") return String(value ?? "").toLowerCase().includes(expected.replaceAll("*", "").replaceAll("%", "").toLowerCase());
  if (op === "gt") return Number(value) > Number(expected);
  if (op === "lte") return Number(value) <= Number(expected);
  throw new Error(`Unsupported fixture filter: ${op}`);
}

function records(table, actor) {
  table = table.replace(/_authorized$/, "");
  const base = { company_id: actor.company ?? companyId, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-21T00:00:00Z", deleted_at: null, is_active: true };
  if (table === "app_users") return [{ ...base, id: actor.sub, role: actor.fixture_role, full_name: `Fixture ${actor.fixture_role.replaceAll("_", " ")}`, email: `${actor.fixture_role}@fixture.invalid`, dealer_id: actor.fixture_role === "dealer_staff" ? id(900) : null, companies: { name: "Synthetic factory - local inspection" } }];
  if (table === "feature_flags") return ["production_planning", "advanced_inventory", "quality_compliance"].map((module_name) => ({ ...base, module_name, is_enabled: actor.scenario !== "disabled" }));
  if (actor.scenario === "empty") return [];
  if (table === "company_settings") return [{ ...base, id: id(950), default_quote_validity_days: 15, default_gst_percent: 18, default_conversion_charge_per_kg: 30, default_packing_charge: 0, default_transport_charge: 0, default_margin_percent: 10, minimum_margin_percent: 8 }];
  if (table === "customers") return [{ ...base, id: id(951), customer_name: "Synthetic fabricator", company_name: "Local Aluminium Works", gst_number: "27SYNTHETIC0000", billing_address: "Synthetic local fixture address", shipping_address: "Fixture site" }];
  if (table === "orders") return Array.from({ length: 34 }, (_, index) => ({ ...base, id: id(501 + index), order_number: `ORD-2026-${String(501 + index).padStart(4, "0")}`, customer_id: id(951), customer_name: "Synthetic fabricator", company_name: "Local Aluminium Works", customers: { customer_name: "Synthetic fabricator", company_name: "Local Aluminium Works" }, order_date: today, expected_dispatch_date: today, order_value: ["owner", "accounts", "sales"].includes(actor.fixture_role) ? 50000 + index * 100 : null, current_stage: index === 33 ? "delivered" : "order_confirmed", priority: index % 2 ? "high" : "normal", order_origin: "manual", order_source_label: "Direct order", notes: "Synthetic order for local acceptance", billets_required: 10, billets_allocated: 10, billet_allocation_status: "allocated", quote_id: null, requested_weight_kg: 200, supplied_weight_kg: 0 }));
  if (table === "aluminium_profiles") return [
    { ...base, id: id(601), profile_code: "EOS-W40-A", profile_name: "Synthetic window frame 40", section_number: "W40", section_code: "A", section_name: "40 mm frame", section_weight_kg_per_m: 0.45, section_perimeter_mm: 120, circumscribing_circle_diameter_mm: 40, nominal_wall_thickness_mm: 1.2, number_of_voids: 1, drawing_revision: "A3", drawing_approval_status: "approved", cross_section_image_url: `${base.company_id}/profiles/window-a.png`, standard_length: 6 },
    { ...base, id: id(602), profile_code: "EOS-W45-B", profile_name: "Synthetic window frame 45", section_number: "W45", section_code: "B", section_name: "45 mm frame", section_weight_kg_per_m: 0.62, section_perimeter_mm: 145, circumscribing_circle_diameter_mm: 45, nominal_wall_thickness_mm: 1.6, number_of_voids: 2, drawing_revision: "B2", drawing_approval_status: "approved", cross_section_image_url: `${base.company_id}/profiles/window-b.png`, standard_length: 6 },
    { ...base, id: id(603), profile_code: "EOS-PENDING", profile_name: "Synthetic unapproved frame", section_weight_kg_per_m: 0.5, drawing_revision: "C1", drawing_approval_status: "pending", cross_section_image_url: `${base.company_id}/profiles/window-a.png` },
    { ...base, id: id(604), profile_code: "EOS-MISSING", profile_name: "Synthetic missing artwork", section_weight_kg_per_m: 0.7, drawing_revision: "D1", drawing_approval_status: "approved", cross_section_image_url: null },
    { ...base, id: id(605), profile_code: "EOS-FAILED", profile_name: "Synthetic unavailable file", section_weight_kg_per_m: 0.8, drawing_revision: "E1", drawing_approval_status: "approved", cross_section_image_url: `${base.company_id}/profiles/missing.png` },
    { ...base, id: id(606), profile_code: "EOS-PDF", profile_name: "Synthetic non-image drawing", section_weight_kg_per_m: 0.9, drawing_revision: "F1", drawing_approval_status: "approved", cross_section_image_url: `${base.company_id}/profiles/document.pdf` },
  ];
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
  if (table === "quotes") return [{ ...base, id: id(301), customer_id: id(951), quote_number: "QUO-2026-0301", status: "sent", valid_until: today, quote_date: today, revision_number: 1, gst_percent: 18, grand_total: 1180 }, ...savedQuotes.filter(row => row.company_id === base.company_id)];
  if (table === "quality_inspections") return [{ ...base, id: id(701), batch_number: "QC-2026-0701", status: "rework", inspection_date: today }];
  if (table === "inventory_items") return [{ ...base, id: id(601), item_code: "BILLET-6063-178", item_name: "6063 billet", current_stock: 0 }];
  return [];
}

// Tiny raster drawings are explicit synthetic source assets for selector QA.
function profilePng(variant) {
  const size = 160;
  const raw = Buffer.alloc(size * (size * 3 + 1), 255);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const outer = x >= 25 && x < 130 && y >= 25 && y < 130;
      const inner = x >= 34 && x < 121 && y >= 34 && y < 121;
      const rib = variant === "b" && x >= 72 && x < 81 && y >= 34 && y < 121;
      const flange = x >= 121 && x < 147 && y >= (variant === "b" ? 93 : 115) && y < (variant === "b" ? 102 : 124);
      if ((outer && !inner) || rib || flange) {
        const offset = y * (size * 3 + 1) + 1 + x * 3;
        raw.set([38, 60, 77], offset);
      }
    }
  }
  const crc = (buffer) => { let value = 0xffffffff; for (const byte of buffer) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (0xedb88320 & -(value & 1)); } return (value ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const body = Buffer.concat([Buffer.from(type), data]); const length = Buffer.alloc(4); length.writeUInt32BE(data.length); const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc(body)); return Buffer.concat([length, body, checksum]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

function operationPage(input, actor) {
  const table = { production: "production_jobs", profiles: "aluminium_profiles", inventory: "inventory_items" }[input.p_module] ?? input.p_module;
  let rows = records(table, actor);
  const search = String(input.p_search ?? "").toLowerCase();
  if (search) rows = rows.filter(row => JSON.stringify(row).toLowerCase().includes(search));
  for (const [key, value] of Object.entries(input.p_filters ?? {})) {
    const field = key === "status" ? (table === "orders" ? "current_stage" : table === "dispatches" ? "delivery_status" : "status") : key === "secondary" ? "priority" : key;
    if (value) rows = rows.filter(row => String(row[field]) === String(value));
  }
  const sort = input.p_sort ?? "created_at", direction = input.p_direction === "desc" ? -1 : 1;
  rows.sort((a, b) => String(a[sort] ?? "").localeCompare(String(b[sort] ?? "")) * direction || a.id.localeCompare(b.id));
  const count = rows.length, offset = (Number(input.p_page ?? 1) - 1) * 10;
  const omitNulls = (value) => Array.isArray(value) ? value.map(omitNulls) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null).map(([key, item]) => [key, omitNulls(item)])) : value;
  return { rows: rows.slice(offset, offset + 10).map(omitNulls), count };
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
  if (url.pathname === "/__evidence") return send(200, { queries, draftWrites });
  if (!["GET", "HEAD"].includes(request.method) && !url.pathname.startsWith("/rest/v1/rpc/")) return send(405, { message: "This synthetic fixture is read-only." });
  if (url.pathname === "/") {
    response.writeHead(200, { "Content-Type": "text/html" });
    return response.end(`<html><head><title>Upgrade local fixtures</title></head><body style="font:18px sans-serif;max-width:900px;margin:40px"><h1>Synthetic local inspection</h1><p>These links use synthetic sessions with the real Next.js application. Only the local in-memory draft simulator accepts writes. No hosted data or credentials are used. This does not emulate PostgreSQL RLS.</p>${roles.map((role) => `<h2>${role}</h2>${scenarios.map((scenario) => `<a style="margin-right:20px;line-height:2" href="/session/${role}/${scenario}">${role} ${scenario}</a>`).join("")}`).join("")}<p><a href="/anonymous">Anonymous access check</a></p></body></html>`);
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
  if (url.pathname.startsWith("/storage/v1/object/documents/")) {
    const path = url.pathname.slice("/storage/v1/object/documents/".length);
    if (!path.startsWith(`${actor.company}/profiles/`)) return send(403, { message: "Wrong synthetic company" });
    queries.push({ role: actor.fixture_role, scenario: actor.scenario, table: "storage", path });
    if (path.endsWith("document.pdf")) { response.writeHead(200, { ...headers, "Content-Type": "application/pdf" }); return response.end("Synthetic non-image fixture"); }
    if (!/window-[ab]\.png$/.test(path)) return send(404, { message: "Synthetic artwork missing" });
    response.writeHead(200, { ...headers, "Content-Type": "image/png" });
    return response.end(profilePng(path.endsWith("window-b.png") ? "b" : "a"));
  }
  const table = url.pathname.split("/").at(-1);
  queries.push({ role: actor.fixture_role, scenario: actor.scenario, table, query: url.search });
  if (url.pathname.includes("/rpc/")) {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const input = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
    queries[queries.length - 1].input = input;
    if (table === "get_unread_notification_count") return send(200, 0);
    if (table === "get_dashboard_snapshot") return actor.scenario === "snapshot_error" ? send(503, { message: "Synthetic snapshot failure" }) : send(200, snapshot(actor));
    if (table === "get_operation_database_page") {
      const result = operationPage(input, actor);
      queries[queries.length - 1].response = result;
      return send(200, result);
    }
    if (table === "save_quote_atomic" && actor.fixture_role === "owner" && input.p_quote && Array.isArray(input.p_items)) {
      if (input.p_quote_id || !input.p_items.length || input.p_items.some(item => !records("aluminium_profiles", actor).some(profile => profile.id === item.profile_id))) return send(409, { message: "Synthetic fixture accepts only new valid drafts" });
      const quoteId = id(2000 + draftWrites.length);
      draftWrites.push({ role: actor.fixture_role, company: actor.company, input, status: "draft", id: quoteId });
      savedQuotes.push({ ...input.p_quote, company_id: actor.company, id: quoteId, quote_number: `LOCAL-DRAFT-${draftWrites.length}`, status: "draft", revision_number: 1, created_at: new Date().toISOString() });
      return send(200, quoteId);
    }
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
