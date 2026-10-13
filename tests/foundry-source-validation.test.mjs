import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
require("tsx/cjs");
const { foundryBatchSchema } = require("../lib/validations/schemas.ts");
const Module = require("node:module");
const schemaSource = readFileSync("lib/validations/schemas.ts", "utf8");
const actionSource = readFileSync("lib/actions/foundry.ts", "utf8");
const formSource = readFileSync("components/modules/operations/record-form-client.tsx", "utf8");
const scrapId = "00000000-0000-4000-8000-000000000001";
const externalSourceId = "00000000-0000-4000-8000-000000000002";
const testBatchId = "00000000-0000-4000-8000-000000000003";
let mockContext;
let permissionAllowed;
let dbCalls;
let dbReply;
let revalidatedPaths;

function resetActionMocks() {
  mockContext = { companyId: "session-company", userId: "session-user", role: "owner" };
  permissionAllowed = true;
  dbCalls = [];
  dbReply = { data: { id: testBatchId }, error: null };
  revalidatedPaths = [];
}

function query(table, operation, payload) {
  const builder = {
    filters: [],
    selected: null,
    eq(column, value) {
      this.filters.push([column, value]);
      return this;
    },
    select(columns) {
      this.selected = columns;
      return this;
    },
    async single() {
      dbCalls.push({ table, operation, payload, filters: this.filters, selected: this.selected });
      return dbReply;
    }
  };
  return builder;
}

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "next/cache") return { revalidatePath: (path) => revalidatedPaths.push(path) };
  if (request === "@/lib/auth") return { getSessionContext: async () => mockContext };
  if (request === "@/lib/auth/permissions") return { can: () => permissionAllowed };
  if (request === "@/lib/supabase/server") {
    return {
      createClient: async () => ({
        from: (table) => ({
          insert: (payload) => query(table, "insert", payload),
          update: (payload) => query(table, "update", payload)
        })
      })
    };
  }
  if (request === "@/lib/utils/errors") {
    return { getErrorMessage: (error, fallback) => error?.message || fallback };
  }
  if (request === "@/lib/validations/schemas") {
    return originalLoad(require.resolve("../lib/validations/schemas.ts"), parent, isMain);
  }
  return originalLoad(request, parent, isMain);
};
const { saveFoundryBatchAction } = require("../lib/actions/foundry.ts");
Module._load = originalLoad;
resetActionMocks();

function batch(overrides = {}) {
  return {
    batch_number: "",
    furnace_number: "F1",
    furnace_name: "",
    batch_sequence: 1,
    order_id: "",
    production_date: "2026-10-08",
    scrap_id: scrapId,
    external_source_id: externalSourceId,
    scrap_percentage: 25,
    external_aluminium_percentage: 75,
    furnace_efficiency_percent: 80,
    required_furnace_charge_kg: 27.363,
    scrap_aluminium_kg: 6.841,
    external_aluminium_kg: 20.522,
    ingot_kg: 0,
    alloy: "6063",
    temper: "T6",
    alloy_density_kg_m3: 2700,
    billet_length_mm: 5800,
    billet_diameter_mm: 152.4,
    billet_diameter_inch: 6,
    billet_count: 24,
    status: "planned",
    alloy_composition_default: { Si: { min: 0.2, max: 0.6 } },
    alloy_composition_actual: { Si: { min: 0.25, max: 0.55 } },
    alloy_composition_altered: true,
    alloy_composition_source: "lab test",
    heat_number: "",
    notes: "",
    ...overrides
  };
}

describe("foundry source validation wiring", () => {
  it("requires both sources for a 25/75 mix and attaches errors to the missing fields", () => {
    const parsed = foundryBatchSchema.safeParse(batch({ scrap_id: "", external_source_id: null }));
    assert.equal(parsed.success, false);
    if (parsed.success) return;
    assert.deepEqual(
      parsed.error.issues.filter((issue) => issue.path[0] === "scrap_id" || issue.path[0] === "external_source_id").map((issue) => issue.path[0]).sort(),
      ["external_source_id", "scrap_id"]
    );
  });

  it("requires only the source for the component used by a pure mix", () => {
    const scrapOnly = foundryBatchSchema.safeParse(batch({ scrap_percentage: 100, external_aluminium_percentage: 0, external_source_id: "" }));
    const externalOnly = foundryBatchSchema.safeParse(batch({ scrap_percentage: 0, external_aluminium_percentage: 100, scrap_id: "" }));
    assert.equal(scrapOnly.success, true);
    assert.equal(externalOnly.success, true);
  });

  it("requires every positive-mix source in every batch status while allowing zero-mix sources to stay empty", () => {
    const statuses = ["planned", "melting", "cast", "homogenizing", "ready", "issued", "cancelled"];
    for (const status of statuses) {
      const missingScrap = foundryBatchSchema.safeParse(batch({ status, scrap_id: "" }));
      const missingExternal = foundryBatchSchema.safeParse(batch({ status, external_source_id: "" }));
      assert.equal(missingScrap.success, false, `${status} must require scrap source for positive scrap mix`);
      assert.equal(missingExternal.success, false, `${status} must require external source for positive external mix`);

      const scrapOnly = foundryBatchSchema.safeParse(batch({ status, scrap_percentage: 100, external_aluminium_percentage: 0, external_source_id: "" }));
      const externalOnly = foundryBatchSchema.safeParse(batch({ status, scrap_percentage: 0, external_aluminium_percentage: 100, scrap_id: "" }));
      assert.equal(scrapOnly.success, true, `${status} must not require a source for zero external mix`);
      assert.equal(externalOnly.success, true, `${status} must not require a source for zero scrap mix`);
    }
  });

  it("keeps zero-component empty IDs valid while rejecting malformed used-component IDs", () => {
    assert.equal(foundryBatchSchema.safeParse(batch({ scrap_percentage: 0, external_aluminium_percentage: 100, scrap_id: "" })).success, true);
    const invalid = foundryBatchSchema.safeParse(batch({ scrap_percentage: 100, external_aluminium_percentage: 0, scrap_id: "not-a-uuid", external_source_id: "" }));
    assert.equal(invalid.success, false);
    if (!invalid.success) assert.ok(invalid.error.issues.some((issue) => issue.path[0] === "scrap_id"));
  });

  it("preserves the 100 percent sum rule and existing chemistry values", () => {
    const parsed = foundryBatchSchema.safeParse(batch());
    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.deepEqual(parsed.data.alloy_composition_default, { Si: { min: 0.2, max: 0.6 } });
      assert.deepEqual(parsed.data.alloy_composition_actual, { Si: { min: 0.25, max: 0.55 } });
      assert.equal(parsed.data.alloy_composition_altered, true);
    }
    const invalidSum = foundryBatchSchema.safeParse(batch({ scrap_percentage: 25, external_aluminium_percentage: 74 }));
    assert.equal(invalidSum.success, false);
    if (!invalidSum.success) assert.ok(invalidSum.error.issues.some((issue) => issue.path[0] === "external_aluminium_percentage" && /must total 100/.test(issue.message)));
  });

  it("adds field-scoped errors for each positive mix component and preserves the 100 percent mix check", () => {
    assert.match(schemaSource, /Math\.abs\(value\.scrap_percentage \+ value\.external_aluminium_percentage - 100\) > 0\.001/);
    assert.match(schemaSource, /value\.scrap_percentage > 0 && !value\.scrap_id/);
    assert.match(schemaSource, /path: \["scrap_id"\]/);
    assert.match(schemaSource, /value\.external_aluminium_percentage > 0 && !value\.external_source_id/);
    assert.match(schemaSource, /path: \["external_source_id"\]/);
  });

  it("uses the shared schema in the authenticated server save and returns database rejection messages", () => {
    assert.match(actionSource, /getSessionContext\(\)/);
    assert.match(actionSource, /can\(context\.role, editingId \? "update" : "create", "foundry"\)/);
    assert.match(actionSource, /foundryBatchSchema\.safeParse\(input\)/);
    assert.match(actionSource, /company_id: context\.companyId/);
    assert.match(actionSource, /getErrorMessage\(error, "Could not save foundry batch"\)/);
  });

  it("routes batch writes through the server action and explains source reservation behavior", () => {
    assert.match(formSource, /saveFoundryBatchAction\(\{ \.\.\.sanitized/);
    assert.match(formSource, /Select a same-company source for each mix percentage above 0%/);
    assert.match(formSource, /New batches start as planned/);
    assert.match(formSource, /Once processing starts or billets are allocated, material, count, and physical dimensions are locked/);
    assert.match(formSource, /cancelling an uncommitted planned batch releases its reservations/i);
    assert.match(formSource, /moduleKey === "foundry" && !editing && field\.name === "status"/);
  });
});

describe("foundry batch server save", () => {
  it("rejects missing source provenance before calling Supabase", async () => {
    resetActionMocks();
    const result = await saveFoundryBatchAction(batch({ scrap_id: "" }));
    assert.equal(result.success, false);
    if (!result.success) assert.match(result.error, /Select a scrap batch/);
    assert.equal(dbCalls.length, 0);
  });

  it("checks create permission before writing", async () => {
    resetActionMocks();
    permissionAllowed = false;
    const result = await saveFoundryBatchAction(batch());
    assert.equal(result.success, false);
    if (!result.success) assert.match(result.error, /permission to save foundry batches/);
    assert.equal(dbCalls.length, 0);
  });

  it("derives tenant and creator from the session, drops legacy fields, and lets the database assign the batch number", async () => {
    resetActionMocks();
    const result = await saveFoundryBatchAction({
      ...batch(),
      company_id: "forged-company",
      created_by: "forged-user",
      order_id: "00000000-0000-4000-8000-000000000099"
    });
    assert.deepEqual(result, { success: true, batchId: testBatchId });
    assert.equal(dbCalls.length, 1);
    const call = dbCalls[0];
    assert.equal(call.table, "foundry_batches");
    assert.equal(call.operation, "insert");
    assert.equal(call.payload.company_id, mockContext.companyId);
    assert.equal(call.payload.created_by, mockContext.userId);
    assert.equal(Object.hasOwn(call.payload, "order_id"), false);
    assert.equal(Object.hasOwn(call.payload, "batch_number"), false);
    assert.equal(call.payload.furnace_name, null);
    assert.equal(call.payload.heat_number, null);
    assert.equal(call.payload.notes, null);
  });

  it("normalizes an unused blank source ID to null on insert", async () => {
    resetActionMocks();
    const result = await saveFoundryBatchAction(batch({ scrap_percentage: 0, external_aluminium_percentage: 100, scrap_id: "" }));
    assert.equal(result.success, true);
    assert.equal(dbCalls[0].payload.scrap_id, null);
    assert.equal(dbCalls[0].payload.external_source_id, externalSourceId);
  });

  it("tenant-scopes updates and surfaces database trigger rejections", async () => {
    resetActionMocks();
    dbReply = { data: null, error: { code: "P0001", message: "Billet is allocated or issued; physical changes are locked." } };
    const result = await saveFoundryBatchAction({ ...batch(), editing_id: testBatchId, company_id: "forged-company" });
    assert.equal(result.success, false);
    if (!result.success) assert.equal(result.error, "Billet is allocated or issued; physical changes are locked.");
    assert.equal(dbCalls.length, 1);
    assert.equal(dbCalls[0].operation, "update");
    assert.deepEqual(dbCalls[0].filters, [["company_id", mockContext.companyId], ["id", testBatchId]]);
    assert.equal(dbCalls[0].payload.company_id, mockContext.companyId);
  });

  it("rejects non-planned new batches before writing", async () => {
    resetActionMocks();
    const result = await saveFoundryBatchAction(batch({ status: "cast" }));
    assert.equal(result.success, false);
    if (!result.success) assert.match(result.error, /must start as planned/);
    assert.equal(dbCalls.length, 0);
  });
});
