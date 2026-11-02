export type FormIssue = { path: string; label: string; message: string };
type Field = { name: string; label: string; required?: boolean };

export function formValidationValues(moduleKey: string, values: Record<string, unknown>) {
  if (moduleKey !== "production") return values;
  const next = { ...values };
  for (const name of ["machine_id", "source_line_id", "length_per_piece_m"]) if (next[name] === "") next[name] = null;
  return next;
}

export function formIssues(issues: readonly { path: (string | number)[]; message: string }[], fields: readonly Field[]): FormIssue[] {
  const labels = new Map(fields.map((field) => [field.name, field.label]));
  const seen = new Set<string>();
  return issues.flatMap((issue) => {
    const path = issue.path.map(String).join(".");
    if (seen.has(path)) return [];
    seen.add(path);
    const root = String(issue.path[0] ?? "");
    const label = labels.get(root) ?? "Record details";
    const line = typeof issue.path[1] === "number" ? `, line ${issue.path[1] + 1}` : "";
    return [{ path, label: `${label}${line}`, message: issue.message }];
  });
}

export function formFieldId(scope: string, path: string) {
  return `${scope}-field-${encodeURIComponent(path)}`;
}

export function focusFormField(container: HTMLElement | null, id: string) {
  const field = document.getElementById(id);
  if (!field || !container?.contains(field)) return;
  for (let parent = field.parentElement; parent && parent !== container; parent = parent.parentElement) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
  }
  const target = (field as HTMLInputElement).disabled && field.parentElement ? field.parentElement : field;
  if (target !== field) target.tabIndex = -1;
  target.focus({ preventScroll: true });
  field.scrollIntoView({ block: "center" });
}

/** Sections affect presentation only. The existing schema still validates every submitted field. */
export function formSection(moduleKey: string, field: Field, values: Record<string, unknown>): "essential" | "observations" | "optional" {
  if (field.required || field.name === "status" || field.name === "delivery_status") return "essential";
  if (["notes", "remarks", "operator_name", "shift", "batch_number", "packaging_number"].includes(field.name)
    && ["production", "quality", "packaging"].includes(moduleKey)) return "optional";
  if (moduleKey === "quality" && ["dimensional_variance", "hardness_webster", "weight_per_meter_actual", "surface_finish_ok"].includes(field.name)) {
    return values.status === "pending" ? "observations" : "essential";
  }
  return "essential";
}

export type FieldProvenance = {
  kind: "source" | "calculated";
  sourceId: string;
  sourceLabel: string;
  revision?: string;
  refreshedAt: string;
  suggested: unknown;
  overridden: boolean;
};

export function applyFieldSuggestions(
  current: Record<string, unknown>, previous: Record<string, FieldProvenance>,
  suggestions: Record<string, unknown>, source: { id: string; label: string; revision?: string },
  refreshedAt: string
) {
  const values = { ...current };
  const provenance = { ...previous };
  for (const [name, suggested] of Object.entries(suggestions)) {
    const old = previous[name];
    const retainOverride = old?.sourceId === source.id && (old.overridden || old.kind === "calculated");
    if (!retainOverride) values[name] = suggested;
    provenance[name] = { kind: "source", sourceId: source.id, sourceLabel: source.label,
      revision: source.revision, refreshedAt, suggested, overridden: Boolean(retainOverride) };
  }
  return { values, provenance };
}

export function markFieldOverride(provenance: Record<string, FieldProvenance>, name: string, value: unknown) {
  const previous = provenance[name];
  return previous ? { ...provenance, [name]: { ...previous, overridden: String(value ?? "") !== String(previous.suggested ?? "") } } : provenance;
}
