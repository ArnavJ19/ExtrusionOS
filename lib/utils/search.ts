export function normalizeSearch(value: unknown) {
  return String(value ?? "").toLowerCase().trim();
}

export function rowMatchesSearch(row: Record<string, unknown>, search: string) {
  const needle = normalizeSearch(search);
  if (!needle) return true;
  return normalizeSearch(JSON.stringify(row)).includes(needle);
}
