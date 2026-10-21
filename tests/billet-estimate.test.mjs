import test from "node:test";
import assert from "node:assert/strict";
import { estimateBilletGeometry, convertBilletDimension } from "../lib/calculations/billet-estimate.ts";
import { calculateBilletWeightKg, calculateTotalBilletWeightKg } from "../lib/calculations/foundry.ts";

const input = { length: 5800, lengthUnit: "mm", diameter: 152.4, diameterUnit: "mm", densityKgPerM3: 2700, count: 24 };

test("equivalent supported units reproduce the batch planning mass", () => {
  const baseline = estimateBilletGeometry(input);
  assert.equal(baseline.ok, true);
  assert.equal(baseline.eachKg, calculateBilletWeightKg(5800, 152.4, 2700));
  assert.equal(baseline.totalKg, calculateTotalBilletWeightKg(5800, 152.4, 24, 2700));
  for (const lengthUnit of ["mm", "cm", "m", "in"]) {
    for (const diameterUnit of ["mm", "cm", "m", "in"]) {
      const estimate = estimateBilletGeometry({ ...input, length: convertBilletDimension(5800, "mm", lengthUnit), lengthUnit, diameter: convertBilletDimension(152.4, "mm", diameterUnit), diameterUnit });
      assert.equal(estimate.ok, true);
      assert.equal(estimate.eachKg, baseline.eachKg);
      assert.equal(estimate.totalKg, baseline.totalKg);
    }
  }
});

test("missing or invalid measurements cannot become a zero estimate", () => {
  for (const key of ["length", "diameter", "densityKgPerM3", "count"]) {
    for (const value of [null, undefined, 0, -1, NaN, Infinity, -Infinity]) {
      assert.equal(estimateBilletGeometry({ ...input, [key]: value }).ok, false, `${key}: ${value}`);
    }
  }
  assert.equal(estimateBilletGeometry({ ...input, count: 1.5 }).ok, false);
  assert.equal(estimateBilletGeometry({ ...input, count: Number.MAX_SAFE_INTEGER + 1 }).ok, false);
  assert.equal(estimateBilletGeometry({ ...input, lengthUnit: "ft" }).ok, false);
  assert.equal(convertBilletDimension(3, "toString", "mm"), null);
});

test("precision overflow and subprecision mass are unavailable", () => {
  assert.equal(estimateBilletGeometry({ ...input, length: 1e308 }).ok, false);
  assert.equal(estimateBilletGeometry({ ...input, densityKgPerM3: 1e308 }).ok, false);
  assert.equal(estimateBilletGeometry({ ...input, diameter: 1e-100 }).ok, false);
});

test("changed planning assumptions leave separately recorded actual facts untouched", () => {
  const source = Object.freeze({ ...input, measuredWeightKg: 123.456, issuedAt: "2026-10-20T12:00:00Z" });
  const first = estimateBilletGeometry(source);
  const revised = estimateBilletGeometry({ ...source, densityKgPerM3: 2800 });
  assert.equal(revised.ok, true);
  assert.notEqual(first.totalKg, revised.totalKg);
  assert.equal(source.measuredWeightKg, 123.456);
  assert.equal(source.densityKgPerM3, 2700);
  assert.equal(source.issuedAt, "2026-10-20T12:00:00Z");
});
