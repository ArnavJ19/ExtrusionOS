import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { buildAdvancedAnalyticsSnapshot, getAnalyticsEvidenceState, parseAdvancedAnalyticsSnapshot } from "../lib/analytics/advanced-dashboard.ts";
import { parseDashboardSnapshot } from "../lib/analytics/dashboard-snapshot.ts";

test("management SQL invariants run against complete new migration twice",()=>{
  const output=execFileSync(process.execPath,["--no-warnings","--experimental-strip-types","scripts/test-management-metrics-integrity.mjs"],{cwd:process.cwd(),encoding:"utf8",timeout:120000});
  assert.match(output,/PASS authority/);
});

test("analytics evidence distinguishes unavailable, stale, partial and verified empty",()=>{
  const now=new Date("2026-10-08T10:00:00Z");
  const empty=buildAdvancedAnalyticsSnapshot({orders:[],quotes:[],productionJobs:[],dispatches:[],invoices:[],payments:[],expenses:[],qualityInspections:[],inventoryItems:[],tasks:[]},now);
  assert.equal(getAnalyticsEvidenceState(empty,"2026-10-08",now),"unavailable");
  const verified={...empty,dataQuality:{version:"20261008",asOf:"2026-10-08",generatedAt:now.toISOString(),currentStateAt:now.toISOString(),unknownShipmentCount:0}};
  assert.equal(getAnalyticsEvidenceState(parseAdvancedAnalyticsSnapshot(verified),"2026-10-08",now),"verified");
  assert.equal(getAnalyticsEvidenceState({...verified,dataQuality:{...verified.dataQuality,unknownShipmentCount:1}},"2026-10-08",now),"partial");
  assert.equal(getAnalyticsEvidenceState(verified,"2026-10-08",new Date("2026-10-08T10:30:00Z")),"stale");
  assert.equal(getAnalyticsEvidenceState(verified,"2026-10-07",now),"unavailable");
  assert.equal(parseAdvancedAnalyticsSnapshot({...verified,kpis:{...verified.kpis,dispatchWeightMtd:null}}),null);
  assert.equal(getAnalyticsEvidenceState({...verified,dataQuality:{...verified.dataQuality,currentStateAt:"2026-10-08T09:00:00Z"}},"2026-10-08",now),"stale");
});

test("pure calculation helper follows the SQL event, cutoff and identity definitions",()=>{
  const data={orders:[{id:"a",customer_id:"customer-a",order_date:"2026-10-02",order_value:100,current_stage:"order_confirmed",customers:{company_name:"Same Name"}},{id:"b",customer_id:"customer-b",order_date:"2026-10-03",order_value:200,current_stage:"order_confirmed",customers:{company_name:"Same Name"}},{id:"future",order_date:"2026-10-20",order_value:9999,current_stage:"order_confirmed"}],quotes:[{id:"old",status:"sent",grand_total:300,quote_date:"2026-09-02",valid_until:"2026-10-10"},{id:"expired",status:"sent",grand_total:900,quote_date:"2026-10-01",valid_until:"2026-10-02"}],productionJobs:[],dispatches:[{id:"pending",delivery_status:"pending",dispatch_date:"2026-10-03",total_weight_kg:9999},{id:"valid",delivery_status:"delivered",actual_dispatched_at:"2026-10-03T21:00:00Z",movement_weight_kg:80,total_weight_kg:9999,orders:{expected_dispatch_date:"2026-10-03"}},{id:"unknown",delivery_status:"dispatched",actual_dispatched_at:"2026-10-02T09:00:00Z",total_weight_kg:700}],invoices:[],payments:[],expenses:[],qualityInspections:[],inventoryItems:[],tasks:[]};
  const result=buildAdvancedAnalyticsSnapshot(data,new Date("2026-10-04T10:00:00Z"));
  assert.equal(result.kpis.bookedRevenueMtd,300);
  assert.equal(result.kpis.quotePipelineValueMtd,300);
  assert.equal(result.topCustomers.length,2);
  assert.equal(result.kpis.dispatchWeightMtd,80);
  assert.equal(result.kpis.dispatchOnTimeRate,0);
  assert.equal(result.trends.at(-1).ordersValue,300);
  assert.equal(result.trends.at(-1).dispatchWeight,80);
});

test("dashboard payload rejects stale data and preserves withheld metrics",()=>{
  const now=new Date("2026-10-08T10:00:00Z");
  const payload={version:"20261008",asOf:"2026-10-08",generatedAt:now.toISOString(),unknownShipmentCount:0,quoteRows:[],orderRows:[],monthlyQuoteValue:null,monthlyOrderValue:null,monthlyQuoteCount:null,monthlyOrderCount:null,activeCustomerCount:null,pendingQuoteCount:null,productionCount:0,todayJobCount:0,pendingDispatchCount:0,dispatchCount:0,dieCorrectionCount:0,qualityHoldCount:0,delayedOrderCount:0,delayedOrders:[],lowInventoryCount:0,lowInventoryRows:[],orderStageDistribution:[]};
  assert.equal(parseDashboardSnapshot(payload,"2026-10-08",now).monthlyOrderValue,null);
  assert.equal(parseDashboardSnapshot(payload,"2026-10-08",new Date("2026-10-08T10:30:00Z")),null);
  assert.equal(parseDashboardSnapshot(payload,"2026-10-07",now),null);
});
