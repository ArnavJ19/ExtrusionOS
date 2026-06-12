import assert from "node:assert/strict";
import test from "node:test";
import { can, hasPermission } from "../lib/auth/permissions.ts";
import { calculateDifference, canAccessDealerRecord, classifyReceiptLine } from "../lib/enterprise/dealer-workflow-rules.ts";
import { simulateDealerQuoteToReceiptWorkflow } from "../lib/enterprise/dealer-order-workflow-simulation.ts";

test("default roles expose required RBAC permissions", () => {
  assert.equal(hasPermission("owner", "manage_roles"), true);
  assert.equal(hasPermission("admin", "manage_company_settings"), false);
  assert.equal(hasPermission("dealer_admin", "receive_dealer_inventory"), true);
  assert.equal(hasPermission("dealer_admin", "create_quotes"), true);
  assert.equal(hasPermission("dealer_admin", "edit_inventory"), false);
  assert.equal(hasPermission("dealer_admin", "manage_users"), false);
  assert.equal(hasPermission("dealer_staff", "approve_inventory_adjustments"), false);
  assert.equal(can("dealer_staff", "create", "quotes"), true);
  assert.equal(can("dealer_staff", "create", "dealer_orders"), true);
  assert.equal(can("dealer_staff", "read", "orders"), false);
  assert.equal(can("dealer_staff", "update", "inventory"), false);
  assert.equal(can("admin", "read", "users"), false);
  assert.equal(can("factory_manager", "update", "dealer_orders"), true);
  assert.equal(can("accounts", "update", "inventory"), false);
});

test("dealer data isolation only allows own dealer unless privileged", () => {
  assert.equal(canAccessDealerRecord("dealer-a", "dealer-a", false), true);
  assert.equal(canAccessDealerRecord("dealer-a", "dealer-b", false), false);
  assert.equal(canAccessDealerRecord(null, "dealer-b", true), true);
});

test("receipt confirmation classifies exact, short, and excess receipts", () => {
  assert.equal(classifyReceiptLine(10, 10), "received_confirmed");
  assert.equal(classifyReceiptLine(10, 8), "discrepancy_reported");
  assert.equal(classifyReceiptLine(10, 12), "discrepancy_reported");
  assert.equal(calculateDifference(10, 8), -2);
  assert.equal(calculateDifference(10, 12), 2);
});

test("dealer quote to order to production to receipt workflow updates dealer stock", () => {
  const result = simulateDealerQuoteToReceiptWorkflow({
    quote: { id: "quote-1", dealerId: "dealer-1", profileId: "profile-1", requiredKg: 100 },
    stock: { profileId: "profile-1", kg: 25 },
    producedKg: 75,
    dispatchedKg: 75,
    receivedKg: 75
  });

  assert.equal(result.quoteStatus, "converted_to_order");
  assert.equal(result.orderDealerId, "dealer-1");
  assert.equal(result.autoFulfilledKg, 25);
  assert.equal(result.stockAfterOrder, 0);
  assert.equal(result.factoryRequiredKg, 75);
  assert.equal(result.productionStatus, "production_completed");
  assert.equal(result.shipmentStatus, "pending_dealer_count");
  assert.equal(result.receiptStatus, "received_confirmed");
  assert.equal(result.finalDealerStockKg, 75);
});
