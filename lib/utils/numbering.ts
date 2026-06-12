export type NumberPrefix = "Q" | "O" | "D" | "DO" | "INV" | "J" | "FB" | "EAS" | "SCR" | "PKG" | "PM";

export function makeBusinessNumber(prefix: NumberPrefix, year: number, sequence: number) {
  return `${prefix}-${year}-${String(sequence).padStart(4, "0")}`;
}

export function nextBusinessNumber(prefix: NumberPrefix, existingNumbers: string[], date = new Date()) {
  const year = date.getFullYear();
  const pattern = new RegExp(`^${prefix}-${year}-(\\d{4})$`);
  const max = existingNumbers.reduce((current, value) => {
    const match = value.match(pattern);
    return match ? Math.max(current, Number(match[1])) : current;
  }, 0);
  return makeBusinessNumber(prefix, year, max + 1);
}
