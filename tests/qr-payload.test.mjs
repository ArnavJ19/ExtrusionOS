import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildQrPayload, parseQrPayload, qrEntityTypes } from "../lib/qr/payload.ts";

describe("Property 25: QR payloads round-trip to company-scoped record references", () => {
  it("round-trips every supported QR entity type", () => {
    for (const entityType of qrEntityTypes) {
      const payload = {
        companyId: "company-123",
        entityType,
        entityId: "record-456",
        nonce: `nonce-${entityType}`,
      };
      assert.deepEqual(parseQrPayload(buildQrPayload(payload)), payload);
    }
  });

  it("rejects malformed or unsupported payloads", () => {
    assert.equal(parseQrPayload("BAD:company:die:record:nonce"), null);
    assert.equal(parseQrPayload("EO:company:unknown:record:nonce"), null);
    assert.equal(parseQrPayload("EO:company:die:record"), null);
  });
});
