import test from "node:test";
import assert from "node:assert/strict";
import { calculateSystemCosting } from "../lib/systems-configurator/costing-engine.ts";

const input={materialSummary:[],totalProfileWeightKg:1,totalProfileLengthM:1,totalGlassAreaSqft:0,totalGlassAreaSqm:0,quantity:1,openingWidthMm:1000,openingHeightMm:1000,aluminiumRatePerKg:100,fabrication:{rateType:"fixed",rate:0},installation:{enabled:false,rateType:"fixed",rate:0},transport:{type:"fixed",amount:0},aluminiumWastagePercent:0,glassWastagePercent:0,marginPercent:20,discountAmount:0,gstPercent:18};
test("realized profit includes discount and distinguishes cost markup from sales margin",()=>{
  const profit=calculateSystemCosting(input);
  assert.equal(profit.realizedProfitAmount,20);
  assert.equal(profit.costMarkupPercent,20);
  assert.equal(profit.salesMarginPercent,16.67);
  assert.equal(profit.profitPercent,profit.costMarkupPercent);
  const loss=calculateSystemCosting({...input,discountAmount:30});
  assert.equal(loss.subtotalBeforeGst,90);
  assert.equal(loss.realizedProfitAmount,-10);
  assert.equal(loss.costMarkupPercent,-10);
  assert.equal(loss.salesMarginPercent,-11.11);
  assert.equal(loss.profitPercent,-10);
});
test("break-even and excessive discounts never show a positive profit",()=>{
  const even=calculateSystemCosting({...input,discountAmount:20});
  assert.equal(even.realizedProfitAmount,0);
  assert.equal(even.profitPercent,0);
  const free=calculateSystemCosting({...input,discountAmount:200});
  assert.equal(free.subtotalBeforeGst,0);
  assert.equal(free.realizedProfitAmount,-100);
  assert.equal(free.costMarkupPercent,-100);
  assert.equal(free.salesMarginPercent,0,"zero selling value has no finite percentage denominator");
});
