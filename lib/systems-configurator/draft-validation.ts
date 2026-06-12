export type DraftJsonIssue = {
  path: "panel_layout_json" | "options_json";
  message: string;
};

function parseJsonObjectField(value: string, path: DraftJsonIssue["path"], label: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { parsed: null, issue: { path, message: `${label} must be a JSON object` } };
    }
    return { parsed: parsed as Record<string, unknown>, issue: null };
  } catch {
    return { parsed: null, issue: { path, message: `${label} is invalid JSON` } };
  }
}

export function validateSystemDraftJsonFields(panelLayoutJson: string, optionsJson: string): DraftJsonIssue[] {
  const issues: DraftJsonIssue[] = [];
  const layoutResult = parseJsonObjectField(panelLayoutJson, "panel_layout_json", "Panel layout JSON");
  const optionsResult = parseJsonObjectField(optionsJson, "options_json", "Options JSON");

  if (layoutResult.issue) issues.push(layoutResult.issue);
  if (optionsResult.issue) issues.push(optionsResult.issue);
  if (!layoutResult.parsed) return issues;

  const panels = Array.isArray(layoutResult.parsed.panels) ? layoutResult.parsed.panels : [];
  if (!panels.length) {
    issues.push({ path: "panel_layout_json", message: "Panel layout must contain panels" });
    return issues;
  }

  const ratioTotal = panels.reduce((sum, panel) => sum + Number((panel as Record<string, unknown>).widthRatio ?? 0), 0);
  if (Math.abs(ratioTotal - 1) > 0.01) issues.push({ path: "panel_layout_json", message: "Panel width ratios must total 1" });

  return issues;
}
