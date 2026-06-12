import test from "node:test";
import assert from "node:assert/strict";
import { buildQuotationAssistantOutput, parseQuotationRequest, redactSensitiveText } from "../lib/ai/quotation-assistant.ts";

test("quotation assistant redacts sensitive costing and bank-like numbers", () => {
  const redacted = redactSensitiveText("Billet rate 245, margin 12%, supplier rate 238, IFSC HDFC0001234, account 123456789012");
  assert.match(redacted, /billet rate: \[REDACTED\]/i);
  assert.match(redacted, /margin: \[REDACTED\]/i);
  assert.match(redacted, /supplier rate: \[REDACTED\]/i);
  assert.match(redacted, /\[IFSC_REDACTED\]/);
  assert.match(redacted, /\[NUMBER_REDACTED\]/);
});

test("quotation assistant parses aluminium extrusion requirement", () => {
  const parsed = parseQuotationRequest("Need 500 kg black powder coated 2-track sliding window profiles for ABC Fabricators, delivery next week, 6063 T5");
  assert.equal(parsed.quantityKg, 500);
  assert.equal(parsed.finish, "powder_coating");
  assert.equal(parsed.application, "sliding_window");
  assert.equal(parsed.alloy, "6063");
  assert.equal(parsed.temper, "T5");
});

test("quotation assistant generates deterministic suggestion output", () => {
  const output = buildQuotationAssistantOutput("Need 500 kg black powder coated 2-track sliding window profiles for ABC Fabricators, delivery next week", {
    customers: [{ id: "c1", customer_name: "ABC", company_name: "ABC Fabricators", gst_number: "27ABCDE1234F1Z5" }],
    profiles: [{ id: "p1", profile_code: "SL-200", profile_name: "2 Track Sliding Window", application_category: "sliding_window", section_weight_kg_per_m: 0.8, finish_options: ["powder_coating"] }],
    similarQuotes: [{ id: "q1", quote_number: "Q-2026-001", status: "sent", customer_name: "ABC Fabricators" }],
    settings: { default_gst_percent: 18, default_margin_percent: 12, default_conversion_charge_per_kg: 30, minimum_margin_percent: 8, redact_sensitive_data: true }
  });

  assert.equal(output.matchedCustomer?.id, "c1");
  assert.equal(output.suggestedItems[0].profile_id, "p1");
  assert.equal(output.suggestedItems[0].estimated_weight_kg, 500);
  assert.equal(output.missingInformation.includes("Confirm exact profile code or system series."), false);
  assert.equal(output.externalAiBlocked, true);
});
