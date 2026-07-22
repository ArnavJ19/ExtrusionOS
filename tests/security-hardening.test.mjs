import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readdir } from "node:fs/promises";
import { hasRouteAccess, isProtectedPath } from "../lib/auth/route-permissions.ts";
import { ManualAccountingProvider } from "../lib/integrations/providers.ts";

describe("route authorization defaults", () => {
  it("protects shipment receipts and grants employee access explicitly", () => {
    assert.equal(isProtectedPath("/shipments/order-1/receipt"), true);
    assert.equal(hasRouteAccess("/shipments/order-1/receipt", "dispatch_manager"), true);
    assert.equal(hasRouteAccess("/shipments/order-1/receipt", "dealer_staff"), false);
  });

  it("does not grant access to an unmapped, unprotected route", () => {
    assert.equal(hasRouteAccess("/future-sensitive-module", "owner"), false);
  });

  it("keeps every dashboard route root in the protected registry", async () => {
    const entries = await readdir(new URL("../app/(dashboard)", import.meta.url), { withFileTypes: true });
    const roots = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith("(")).map((entry) => `/${entry.name}`);
    for (const root of roots) assert.equal(isProtectedPath(root), true, `${root} must be protected by the proxy`);
  });
});

describe("manual integration providers", () => {
  it("do not report successful automated delivery", async () => {
    const provider = new ManualAccountingProvider({
      companyId: "00000000-0000-4000-8000-000000000001",
      providerName: "Tally",
      config: {},
    });
    const result = await provider.exportInvoice({
      invoiceId: "invoice-1",
      invoiceNumber: "INV-1",
      customerName: "Customer",
      amount: 100,
    });
    assert.equal(result.success, false);
    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /no automated connector configured/i);
  });
});

describe("distributed rate limit migration", () => {
  it("is service-role only and atomically locks counters", async () => {
    const { readFile } = await import("node:fs/promises");
    const migration = await readFile(new URL("../supabase/migrations/20260715030000_distributed_api_rate_limits.sql", import.meta.url), "utf8");
    assert.match(migration, /for update/i);
    assert.match(migration, /revoke all on function[\s\S]+anon, authenticated/i);
    assert.match(migration, /grant execute[\s\S]+service_role/i);
  });
});
