export type TimestampEvidence = { label: string; value: string | null; status: "recent" | "stale" | "missing" | "invalid" | "future"; ageMs: number | null };

export function dataFreshnessQueryKey(scope: string, moduleKey: string, query: { search: string; status: string; secondary: string; dateFrom: string; dateTo: string; page: number; sortColumn: string; sortDirection: string; relationFilters: { field: string; value: string }[] }): string {
  return JSON.stringify([scope, moduleKey, query.search, query.status, query.secondary, query.dateFrom, query.dateTo, query.page, query.sortColumn, query.sortDirection, query.relationFilters]);
}

const observationFields = ["observed_at", "last_observed_at", "last_counted_at", "physical_observation_at"] as const;
const sourceFields = ["source_system", "source_name", "import_source", "source_reference"] as const;

function timestampEvidence(label: string, value: unknown, now: number, staleAfterMs: number): TimestampEvidence {
  if (value == null || value === "") return { label, value: null, status: "missing", ageMs: null };
  if (typeof value !== "string" && typeof value !== "number") return { label, value: null, status: "invalid", ageMs: null };
  const parsed = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(parsed) || !Number.isFinite(new Date(parsed).getTime())) return { label, value: String(value), status: "invalid", ageMs: null };
  const ageMs = now - parsed;
  if (ageMs < -5 * 60 * 1000) return { label, value: new Date(parsed).toISOString(), status: "future", ageMs };
  return { label, value: new Date(parsed).toISOString(), status: ageMs > staleAfterMs ? "stale" : "recent", ageMs: Math.max(0, ageMs) };
}

export function describeDataFreshness(row: Record<string, unknown>, options: { now?: number; staleAfterMs?: number } = {}) {
  const now = options.now ?? Date.now();
  const staleAfterMs = options.staleAfterMs ?? 30 * 24 * 60 * 60 * 1000;
  const updated = timestampEvidence("Record updated", row.updated_at, now, staleAfterMs);
  const created = timestampEvidence("Record created", row.created_at, now, staleAfterMs);
  const recordTime = updated.status === "missing" ? created : updated;
  const observedField = observationFields.find((field) => row[field] != null && row[field] !== "");
  const observation = observedField
    ? timestampEvidence("Physical observation / verification", row[observedField], now, staleAfterMs)
    : timestampEvidence("Physical observation / verification", null, now, staleAfterMs);
  const verification = timestampEvidence("Data verification", row.verified_at, now, staleAfterMs);
  const sourceField = sourceFields.find((field) => typeof row[field] === "string" && row[field]!.trim());
  const source = sourceField ? String(row[sourceField]).slice(0, 160) : null;
  return { recordTime, updated, created, observation, verification, source };
}

export function formatFreshnessTimestamp(value: string | null, locale = "en-IN"): string {
  if (!value) return "Not recorded";
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(parsed) : "Invalid timestamp";
}

export function freshnessStatusLabel(status: TimestampEvidence["status"], staleAfterMs = 30 * 24 * 60 * 60 * 1000): string {
  const thresholdDays = Math.max(1, Math.ceil(staleAfterMs / (24 * 60 * 60 * 1000)));
  return ({ recent: `Within ${thresholdDays}-day record threshold`, stale: `Older than ${thresholdDays}-day record threshold`, missing: "Not recorded", invalid: "Invalid timestamp", future: "Future timestamp needs review" })[status];
}
