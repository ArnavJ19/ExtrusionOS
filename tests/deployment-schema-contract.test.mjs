import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
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
    const checks = await checkHostedSchemaContract("http://localhost:54321", key, async (url, values) => {
      headers.push(values);
      return { ok: true, status: 200, json: async () => url.pathname.endsWith("/rest/v1/")
        ? { paths: Object.fromEntries(REQUIRED_API_FUNCTIONS.map((name) => [`/rpc/${name}`, {}])) }
        : [] };
    });
    assert.ok(checks.every((check) => check.status === "verified"));
    assert.ok(headers.every((value) => value.apikey === key));
    assert.equal(headers[0].Authorization, key.startsWith("eyJ") ? `Bearer ${key}` : undefined);
  }
});

test("successful HTTP responses require valid empty column-query data", async () => {
  const paths = Object.fromEntries(REQUIRED_API_FUNCTIONS.map((name) => [`/rpc/${name}`, {}]));
  for (const body of [null, {}, { code: "42501", message: "private detail" }, [{ supplier_snapshot: "private row" }]]) {
    const { read } = reader({ paths }, {
      supplier_snapshot: { ok: true, status: 200, json: async () => body }
    });
    const checks = await checkHostedSchemaContract("https://example.supabase.co", "unused", read);
    assert.equal(checks.find((check) => check.check === "invoices:supplier_snapshot").status, "unavailable");
    assert.ok(checks.every((check) => !check.detail.includes("private")));
  }
});

test("credential-bearing and non-HTTP local URLs fail before any request", async () => {
  for (const url of ["ftp://localhost", "file://localhost", "https://user:password@example.supabase.co", "http://remote.example"]) {
    let calls = 0;
    await assert.rejects(checkHostedSchemaContract(url, "unused", async () => { calls++; }), /HTTP|credentials/);
    assert.equal(calls, 0);
  }
  for (const key of ["", "   "]) {
    await assert.rejects(checkHostedSchemaContract("https://example.supabase.co", key, async () => {
      assert.fail("An empty API key must not be sent");
    }), /credential/);
  }
});

test("malformed OpenAPI paths, transport failures and unreadable JSON stay unavailable", async () => {
  for (const schema of [null, [], {}, { paths: [] }, { paths: "private error" }]) {
    const { read } = reader(schema);
    const checks = await checkHostedSchemaContract("https://example.supabase.co", "unused", read);
    assert.ok(checks.filter((check) => check.check.startsWith("rpc:")).every((check) => check.status === "unavailable"));
  }
  for (const read of [
    async () => { throw new Error("private transport detail"); },
    async () => ({ ok: true, status: 200, json: async () => { throw new Error("private parse detail"); } })
  ]) {
    const checks = await checkHostedSchemaContract("https://example.supabase.co", "unused", read);
    assert.ok(checks.every((check) => check.status === "unavailable" && !check.detail.includes("private")));
  }
});

test("missing exposure differs from permission and server failures", async () => {
  for (const [code, status] of [["42703", "missing"], ["PGRST204", "missing"], ["42501", "unavailable"], ["PGRST205", "unavailable"]]) {
    const { read } = reader({ paths: {} }, {
      supplier_snapshot: { ok: false, status: 400, json: async () => ({ code, message: "private detail" }) }
    });
    const checks = await checkHostedSchemaContract("https://example.supabase.co", "unused", read);
    assert.equal(checks.find((check) => check.check === "invoices:supplier_snapshot").status, status);
    assert.match(checks.find((check) => check.check === "rpc:save_system_configuration_atomic").detail, /credential.*catalog/i);
  }
});

test("each loopback HTTP URL uses only schema and zero-row table requests", async () => {
  for (const baseUrl of ["http://localhost:54321", "http://127.0.0.1:54321", "http://[::1]:54321"]) {
    const paths = Object.fromEntries(REQUIRED_API_FUNCTIONS.map((name) => [`/rpc/${name}`, {}]));
    const { read, requests } = reader({ paths });
    const checks = await checkHostedSchemaContract(baseUrl, "unused", read);
    assert.ok(checks.every((check) => check.status === "verified"));
    assert.ok(requests.every((url) => url.origin === new URL(baseUrl).origin));
    assert.ok(requests.every((url) => !url.pathname.includes("/rpc/")));
  }
});

test("invalid RPC entries cannot verify function exposure", async () => {
  for (const entry of [null, [], "private error", 42, true]) {
    const { read } = reader({ paths: { "/rpc/save_system_configuration_atomic": entry } });
    const checks = await checkHostedSchemaContract("https://example.supabase.co", "unused", read);
    assert.equal(checks.find((check) => check.check === "rpc:save_system_configuration_atomic").status, "unavailable");
  }
});

function runHostedCli(url, args = ["--hosted"]) {
  return new Promise((resolve, reject) => {
    const script = fileURLToPath(new URL("../scripts/check-hosted-schema-contract.mjs", import.meta.url));
    const child = spawn(process.execPath, ["--no-warnings", "--experimental-strip-types", script, ...args], {
      env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: "sb_secret_fixture_only" },
      signal: AbortSignal.timeout(20000)
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (value) => { stdout += value; });
    child.stderr.on("data", (value) => { stderr += value; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("the actual hosted CLI sends only GET schema and zero-row probes after explicit opt-in", async () => {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method, url: request.url, headers: request.headers });
    const url = new URL(request.url, "http://localhost");
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(url.pathname === "/rest/v1/"
      ? { paths: Object.fromEntries(REQUIRED_API_FUNCTIONS.map((name) => [`/rpc/${name}`, {}])) }
      : []));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    const result = await runHostedCli(url);
    assert.equal(result.code, 0, result.stderr);
    assert.ok(JSON.parse(result.stdout).checks.every((check) => check.status === "verified"));
    assert.equal(requests.length, 1 + REQUIRED_COLUMN_CHECKS.length);
    assert.ok(requests.every((request) => request.method === "GET" && request.headers.apikey === "sb_secret_fixture_only"));
    assert.ok(requests.every((request) => !request.headers.authorization && !request.url.includes("/rpc/")));
    assert.ok(requests.slice(1).every((request) => new URL(request.url, url).searchParams.get("limit") === "0"));
    const refused = await runHostedCli(url, []);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /--hosted/);
    assert.equal(requests.length, 1 + REQUIRED_COLUMN_CHECKS.length);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("the actual hosted CLI never follows redirects or prints remote error details", async () => {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    response.writeHead(302, { Location: "/private-redirect" });
    response.end("private remote detail");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const result = await runHostedCli(`http://127.0.0.1:${server.address().port}`);
    assert.equal(result.code, 1);
    assert.ok(JSON.parse(result.stdout).checks.every((check) => check.status === "unavailable"));
    assert.equal(requests.length, 1 + REQUIRED_COLUMN_CHECKS.length);
    assert.ok(requests.every((url) => url !== "/private-redirect"));
    assert.ok(!result.stdout.includes("private remote detail") && !result.stderr.includes("private remote detail"));
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
