// AP-087: the on-screen keypad's key handling, kept pure so it can be tested. A value is a plain string the person is
// building; the field parses it on submit. Only digits and (for decimal fields) one decimal point are accepted.
export type KeypadKey = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "." | "back" | "clear";

export const KEYPAD_ROWS: KeypadKey[][] = [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"], [".", "0", "back"]];

export function applyKeypadKey(value: string, key: KeypadKey, options: { decimal: boolean; maxLength?: number; maxDecimals?: number } = { decimal: true }): string {
  const maxLength = options.maxLength ?? 12;
  if (key === "clear") return "";
  if (key === "back") return value.slice(0, -1);
  if (key === ".") {
    if (!options.decimal || value.includes(".")) return value;
    return value === "" ? "0." : value.length < maxLength ? `${value}.` : value;
  }
  if (!/^[0-9]$/.test(key) || value.length >= maxLength) return value;
  const [, decimals = ""] = value.split(".");
  if (value.includes(".") && options.maxDecimals !== undefined && decimals.length >= options.maxDecimals) return value;
  if (value === "0") return key;
  return value + key;
}

/** Keeps typed input to digits and one decimal point (the same rule as the keypad). */
export function cleanNumericInput(raw: string, decimal: boolean): string {
  let seenPoint = false;
  let out = "";
  for (const char of raw) {
    if (/[0-9]/.test(char)) out += char;
    else if (decimal && (char === "." || char === ",") && !seenPoint) { out += "."; seenPoint = true; }
  }
  return out;
}

/** Parses the built string; blank stays null (never zero). */
export function parseKeypadValue(value: string): number | null {
  if (value.trim() === "" || value === ".") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
