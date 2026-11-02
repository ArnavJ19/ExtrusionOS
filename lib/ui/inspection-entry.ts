import type { Evaluation } from "../workflow/inspection-plans.ts";
import type { FormIssue } from "./form-workflow.ts";

export type ObservationResult = { item_id: string; observed: number } | { item_id: string; visual_ok: boolean };
export function buildInspectionEntry(evaluation: Evaluation, values: Record<string, string>) {
  const results: ObservationResult[] = [];
  const issues: FormIssue[] = [];
  if (evaluation.state === "no_plan") return { results, issues: [{ path: "", label: "Inspection plan", message: "An approved applicable plan is required." }] };
  for (const item of evaluation.items) {
    const value = values[item.item_id]?.trim();
    if (!value) continue;
    if (item.unit === "visual") {
      if (!["pass", "fail"].includes(value)) issues.push({ path: item.item_id, label: item.characteristic, message: "Choose pass or fail." });
      else results.push({ item_id: item.item_id, visual_ok: value === "pass" });
    } else if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) || !Number.isFinite(Number(value))) {
      issues.push({ path: item.item_id, label: item.characteristic, message: `Enter a finite decimal measurement in ${item.unit}.` });
    } else results.push({ item_id: item.item_id, observed: Number(value) });
  }
  if (!results.length && !issues.length) issues.push({ path: evaluation.items[0]?.item_id ?? "", label: "Observations", message: "Enter at least one actual observation. Blank entries do not replace saved results." });
  return { results, issues };
}

const MAX_DRAFT_AGE = 8 * 60 * 60 * 1000;
export function inspectionDraftKey(scope: string, inspectionId: string, planId: string, version: number) {
  return `extrusionos:inspection-entry:v1:${scope}:${inspectionId}:${planId}:${version}`;
}

export function restoreInspectionDraft(raw: string | null, scope: string, evaluation: Evaluation, now = Date.now()): Record<string, string> {
  return restoreInspectionDraftState(raw, scope, evaluation, now).values;
}

export function restoreInspectionDraftState(raw: string | null, scope: string, evaluation: Evaluation, now = Date.now()): { values: Record<string, string>; uncertain: boolean } {
  const empty = { values: {}, uncertain: false };
  if (!raw || raw.length > 20000 || evaluation.state === "no_plan") return empty;
  try {
    const draft = JSON.parse(raw);
    if (draft.scope !== scope || draft.planId !== evaluation.plan_id || draft.version !== evaluation.plan_version || typeof draft.savedAt !== "number" || !Number.isFinite(draft.savedAt) || draft.savedAt > now || now - draft.savedAt > MAX_DRAFT_AGE || !draft.values || typeof draft.values !== "object" || Array.isArray(draft.values)) return empty;
    return { values: Object.fromEntries(evaluation.items.flatMap((item) => typeof draft.values[item.item_id] === "string" && draft.values[item.item_id].length <= 120 ? [[item.item_id, draft.values[item.item_id]]] : [])), uncertain: draft.uncertain === true };
  } catch { return empty; }
}

export function observationMatches(result: ObservationResult, evaluation: Evaluation) {
  if (evaluation.state === "no_plan") return false;
  const item = evaluation.items.find((entry) => entry.item_id === result.item_id);
  return Boolean(item && ("observed" in result ? item.observed === result.observed : item.visual_ok === result.visual_ok));
}
