import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const actions = readFileSync("lib/actions/payments.ts", "utf8");
const route = readFileSync("app/api/payments/route.ts", "utf8");

test("payment server-action module exports only async action functions and types", () => {
  assert.match(actions, /^"use server";/);
  assert.doesNotMatch(actions, /export const recordPaymentInputSchema/);
  assert.match(actions, /export async function recordPaymentAction/);
  assert.match(actions, /export async function reversePaymentAction/);
  assert.doesNotMatch(route, /recordPaymentInputSchema/);
  assert.match(route, /recordPaymentAction\(input\)/);
});
