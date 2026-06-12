import test from "node:test";
import assert from "node:assert/strict";
import { indianPhone } from "../lib/validations/common.ts";

test("Indian phone validation accepts common mobile formats", () => {
  assert.equal(indianPhone.safeParse("9876543210").success, true);
  assert.equal(indianPhone.safeParse("09876543210").success, true);
  assert.equal(indianPhone.safeParse("91 98765 43210").success, true);
  assert.equal(indianPhone.safeParse("+91-98765-43210").success, true);
  assert.equal(indianPhone.safeParse("(+91) 98765 43210").success, true);
});

test("Indian phone validation rejects invalid mobile numbers", () => {
  assert.equal(indianPhone.safeParse("1234567890").success, false);
  assert.equal(indianPhone.safeParse("987654321").success, false);
  assert.equal(indianPhone.safeParse("98765432101").success, false);
});
