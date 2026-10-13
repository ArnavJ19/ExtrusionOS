import test from "node:test";
import assert from "node:assert/strict";
import { checkHostedSchemaContract, REQUIRED_API_FUNCTIONS, REQUIRED_COLUMN_CHECKS } from "../lib/deployment/schema-contract.ts";

function reader(schema, columns = {}) {
  const requests = [];
  const read = async (url) => {
    requests.push(url);
    if (url.pathname.endsWith("/rest/v1/")) return { ok: true, status: 200, json: async () => schema };
    assert.equal(url.searchParams.get("limit"), "0", "column probes must never read business rows");
    const reply = columns[url.searchParams.get("select")];
    return reply || { ok: true, status: 200, json: async () => [] };
  };
  return { read, requests };
}

test("schema contract distinguishes advertised RPCs and absent columns using zero-row reads", async () => {
  const paths = Object.fromEntries(REQUIRED_API_FUNCTIONS.slice(1).map((name) => [`/rpc/${name}`, {}]));
  const { read, requests } = reader({ paths }, {
    supplier_snapshot: { ok: false, status: 400, json: async () => ({ code: "42703", message: "sensitive details" }) }
  });
  const checks = await checkHostedSchemaContract("https://example.supabase.co", "unused", read);
  assert.equal(checks.find((check) => check.check === "rpc:save_system_configuration_atomic").status, "missing");
  assert.equal(checks.find((check) => check.check === "rpc:save_order_atomic").status, "verified");
  assert.equal(checks.find((check) => check.check === "invoices:supplier_snapshot").status, "missing");
  assert.equal(checks.find((check) => check.check === "invoices:customer_snapshot").status, "verified");
  assert.equal(requests.length, 1 + REQUIRED_COLUMN_CHECKS.length);
  assert.ok(checks.every((check) => !check.detail.includes("sensitive details")));
});

test("unavailable schema or credentials cannot become a verified empty contract", async () => {
  const checks = await checkHostedSchemaContract("https://example.supabase.co", "unused", async () => ({
    ok: false, status: 401, json: async () => ({ code: "42501" })
  }));
  assert.ok(checks.every((check) => check.status === "unavailable"));
  await assert.rejects(checkHostedSchemaContract("http://remote.example", "unused", async () => {}), /HTTPS/);
});

test("publishable keys use apikey and legacy JWT keys also use bearer authorization", async () => {
  for (const key of ["sb_publishable_example", "eyJlegacy.example.signature"]) {
    const headers = [];
    const checks = await checkHostedSchemaContract("http://localhost:54321", key, async (_url, values) => {
      headers.push(values);
      return { ok: true, status: 200, json: async () => ({ paths: Object.fromEntries(REQUIRED_API_FUNCTIONS.map((name) => [`/rpc/${name}`, {}])) }) };
    });
    assert.ok(checks.every((check) => check.status === "verified"));
    assert.ok(headers.every((value) => value.apikey === key));
    assert.equal(headers[0].Authorization, key.startsWith("eyJ") ? `Bearer ${key}` : undefined);
  }
});
