import { createRequire } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
require("tsx/cjs");
const Module = require("node:module");
const invoiceId = "00000000-0000-4000-8000-000000000001";
let allowed = true;
let invoice;
let items;
let queries;
class NextResponse extends Response {
  static json(body, init) { return new NextResponse(JSON.stringify(body), { ...init, headers: { "Content-Type": "application/json" } }); }
}
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "next/server") return { NextResponse };
  if (request === "@/lib/auth") return { getSessionContext: async () => ({ companyId: "session-company", role: "accounts" }) };
  if (request === "@/lib/auth/permissions") return { can: () => allowed };
  if (request === "@/lib/pdf/invoice-pdf") return { buildInvoicePdf: async () => new Uint8Array([37, 80, 68, 70]) };
  if (request === "@/lib/supabase/server") return {
    createClient: async () => ({ from: (table) => {
      const filters = [];
      queries.push({ table, filters });
      return {
        select() { return this; },
        eq(column, value) { filters.push([column, value]); return this; },
        maybeSingle: async () => invoice,
        order: async () => items
      };
    } })
  };
  return originalLoad(request, parent, isMain);
};
const { GET } = require("../app/api/pdf/invoice/[id]/route.ts");
Module._load = originalLoad;
function reset() {
  allowed = true;
  queries = [];
  invoice = { data: { supplier_snapshot: {}, customer_snapshot: {} }, error: null };
  items = { data: [], error: null };
}
const call = () => GET(new Request("http://localhost"), { params: Promise.resolve({ id: invoiceId }) });

test("invoice schema/query failure is unavailable, while a genuinely absent invoice is 404", async () => {
  reset();
  invoice = { data: null, error: { code: "42703", message: "private database detail" } };
  let response = await call();
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /unavailable/);
  reset();
  invoice = { data: null, error: null };
  response = await call();
  assert.equal(response.status, 404);
});

test("line-query errors are unavailable and cannot generate an empty issued invoice", async () => {
  reset();
  items = { data: null, error: { code: "42501" } };
  assert.equal((await call()).status, 503);
});

test("invoice PDF still enforces financial permission, tenant filters and historical party snapshots", async () => {
  reset();
  allowed = false;
  assert.equal((await call()).status, 403);
  assert.equal(queries.length, 0);
  reset();
  invoice.data.customer_snapshot = null;
  assert.equal((await call()).status, 409);
  reset();
  const response = await call();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  // Every query is tenant-scoped: business tables by company_id, the companies row (logo) by its id.
  assert.ok(queries.every((query) => query.filters.some(([column, value]) => (query.table === "companies" ? column === "id" : column === "company_id") && value === "session-company")));
  assert.ok(queries.some((query) => query.table === "companies"), "the company logo is looked up for the session company");
});
