import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const form = readFileSync("components/modules/operations/record-form-client.tsx", "utf8");
const config = readFileSync("components/modules/operations/module-config.ts", "utf8");
const actions = readFileSync("lib/actions/quotes-orders.ts", "utf8");

describe("server-owned order edits", () => {
  it("delegates generic order forms to the guarded server action", () => {
    const guardedBranch = form.indexOf('if (moduleKey === "orders")');
    const genericUpdate = form.indexOf('.from(config.table as any).update');
    assert.ok(guardedBranch >= 0);
    assert.ok(genericUpdate > guardedBranch);
    assert.match(form, /saveOrderAction/);
  });

  it("does not expose order stage as an editable form field", () => {
    const orderBlock = config.slice(config.indexOf("  orders:"), config.indexOf("  quotes:"));
    assert.doesNotMatch(orderBlock, /name: "current_stage"/);
  });

  it("does not retain a free-form stage mutation action", () => {
    assert.doesNotMatch(actions, /updateOrderStageAction/);
  });

  it("locks commercial and production identity after order creation", () => {
    assert.match(actions, /immutableIdentityChanged/);
    assert.match(actions, /Customer, quote, production requirement, order date, and value are fixed after order creation/);
    const orderBlock = config.slice(config.indexOf("  orders:"), config.indexOf("  quotes:"));
    for (const field of ["customer_id", "quote_id", "production_profile_id", "production_die_id", "production_quantity_kg", "production_pieces", "order_date", "order_value"]) {
      assert.match(orderBlock, new RegExp(`name: "${field}"[^\\n]*readOnly: true`));
    }
  });
});
