import test from "node:test";
import assert from "node:assert/strict";
import { runDealerFulfillmentIntegrityChecks } from "../scripts/test-dealer-fulfillment-integrity.mjs";

test("dealer quote conversion preserves role guards, remaining holds and kg/piece/metre lineage",async()=>{
  assert.deepEqual(await runDealerFulfillmentIntegrityChecks(),[
    "dealer and sales conversions reconcile protected order lines and exact remaining physical stock",
    "fractional pieces and held-stock over-allocation roll back header, lines and stock",
    "a sibling dealer cannot convert another dealership's quote even when named as its creator",
    "suspended identities and forged private fulfillment authorizations fail closed",
    "cancellation after actual quote conversion preserves dealer physical debits and immutable commercial lineage"
  ]);
});
