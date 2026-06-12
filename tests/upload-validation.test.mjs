import test from "node:test";
import assert from "node:assert/strict";
import { maintenanceBillUploadRules, technicalDrawingUploadRules, validateUploadFile } from "../lib/validations/uploads.ts";

test("technical drawing uploads reject SVG and oversized files", () => {
  assert.equal(validateUploadFile({ name: "section.svg", size: 1024, type: "image/svg+xml" }, technicalDrawingUploadRules).ok, false);
  assert.equal(validateUploadFile({ name: "large.pdf", size: 26 * 1024 * 1024, type: "application/pdf" }, technicalDrawingUploadRules).ok, false);
});

test("technical drawing uploads allow CAD extensions with empty mime type", () => {
  const result = validateUploadFile({ name: "die-profile.dxf", size: 128 * 1024, type: "" }, technicalDrawingUploadRules);
  assert.equal(result.ok, true);
});

test("maintenance bill uploads only allow safe bill evidence types", () => {
  assert.equal(validateUploadFile({ name: "bill.pdf", size: 1024, type: "application/pdf" }, maintenanceBillUploadRules).ok, true);
  assert.equal(validateUploadFile({ name: "bill.svg", size: 1024, type: "image/svg+xml" }, maintenanceBillUploadRules).ok, false);
  assert.equal(validateUploadFile({ name: "bill.webp", size: 11 * 1024 * 1024, type: "image/webp" }, maintenanceBillUploadRules).ok, false);
});
