import test from "node:test";
import assert from "node:assert/strict";
import { getConfiguratorWorkflowStatus, productionJobMatchesConfiguration } from "../lib/systems-configurator/workflow-status.ts";

const dataReady = { status: "ready", issues: [], criticalCount: 0, warningCount: 0 };
const dataMissing = { status: "critical", issues: [], criticalCount: 1, warningCount: 0 };
const outputMissing = { productionReady: false, optimizationReady: false, missingOutputs: ["Cutting list"], completedOutputs: [] };
const outputReady = { productionReady: true, optimizationReady: true, missingOutputs: [], completedOutputs: ["Cutting list"] };
const quoteBlocked = { ready: false, reason: "blocked" };
const quoteReady = { ready: true, reason: null };
const productionBlocked = { ready: false, reason: "blocked" };
const productionReady = { ready: true, reason: null };
const noProgress = { jobCount: 0, plannedKg: 0, actualKg: 0, plannedMeters: 0, actualMeters: 0, progressPercent: 0, completedJobs: 0, activeJobs: 0, status: "not_started" };

test("workflow status prioritizes production progress and completion", () => {
  assert.equal(getConfiguratorWorkflowStatus({ configurationStatus: "in_production", dataReadiness: dataReady, outputStatus: outputReady, quoteReadiness: quoteReady, productionReadiness: productionBlocked, productionProgress: { ...noProgress, jobCount: 2, status: "in_progress" } }).stage, "in_production");
  assert.equal(getConfiguratorWorkflowStatus({ configurationStatus: "completed", dataReadiness: dataReady, outputStatus: outputReady, quoteReadiness: quoteReady, productionReadiness: productionBlocked, productionProgress: { ...noProgress, jobCount: 2, status: "completed" } }).stage, "completed");
});

test("workflow status reports data, calculation, quote, and handoff stages", () => {
  assert.equal(getConfiguratorWorkflowStatus({ configurationStatus: "draft", dataReadiness: dataMissing, outputStatus: outputMissing, quoteReadiness: quoteBlocked, productionReadiness: productionBlocked, productionProgress: noProgress }).stage, "needs_data");
  assert.equal(getConfiguratorWorkflowStatus({ configurationStatus: "draft", dataReadiness: dataReady, outputStatus: outputMissing, quoteReadiness: quoteBlocked, productionReadiness: productionBlocked, productionProgress: noProgress }).stage, "ready_to_calculate");
  assert.equal(getConfiguratorWorkflowStatus({ configurationStatus: "calculated", dataReadiness: dataReady, outputStatus: outputReady, quoteReadiness: quoteReady, productionReadiness: productionBlocked, productionProgress: noProgress }).stage, "ready_to_quote");
  assert.equal(getConfiguratorWorkflowStatus({ configurationStatus: "quoted", quoteId: "q1", dataReadiness: dataReady, outputStatus: outputReady, quoteReadiness: quoteReady, productionReadiness: productionReady, productionProgress: noProgress }).stage, "ready_for_production");
});

test("workflow production job matcher requires order and configuration token", () => {
  assert.equal(productionJobMatchesConfiguration({ order_id: "o1", remarks: "System configuration SC-2026-0001 / W01" }, { order_id: "o1", configuration_number: "SC-2026-0001" }), true);
  assert.equal(productionJobMatchesConfiguration({ order_id: "o1", remarks: "System configuration SC-2026-0002 / W02" }, { order_id: "o1", configuration_number: "SC-2026-0001" }), false);
  assert.equal(productionJobMatchesConfiguration({ order_id: "o2", remarks: "System configuration SC-2026-0001 / W01" }, { order_id: "o1", configuration_number: "SC-2026-0001" }), false);
});
