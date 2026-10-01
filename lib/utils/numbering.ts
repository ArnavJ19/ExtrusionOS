export type NumberPrefix = "Q" | "O" | "D" | "DO" | "INV" | "J" | "FB" | "EAS" | "SCR" | "PKG" | "PM";

export function makeBusinessNumber(prefix: NumberPrefix, year: number, sequence: number) {
  return `${prefix}-${year}-${String(sequence).padStart(4, "0")}`;
}

/** Display preview only. Persisted numbers are allocated by the database. */
export function previewBusinessNumber(prefix: NumberPrefix, existingNumbers: string[], date = new Date()) {
  const year = Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Kolkata", year: "numeric" }).format(date));
  const pattern = new RegExp(`^${prefix}-${year}-(\\d+)$`);
  const max = existingNumbers.reduce((current, value) => {
    const match = value.match(pattern);
    return match ? Math.max(current, Number(match[1])) : current;
  }, 0);
  return makeBusinessNumber(prefix, year, max + 1);
}
