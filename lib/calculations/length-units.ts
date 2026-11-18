export const lengthUnits = { m: "metres", mm: "millimetres", ft: "feet", in: "inches" } as const;
export type LengthUnit = keyof typeof lengthUnits;
const scale = BigInt("1000000000000");
const factors: Record<LengthUnit, [bigint, bigint]> = { m: [BigInt(1), BigInt(1)], mm: [BigInt(1), BigInt(1000)], ft: [BigInt(381), BigInt(1250)], in: [BigInt(127), BigInt(5000)] };
const rounded = (value: bigint, divisor: bigint) => (value + divisor / BigInt(2)) / divisor;
const decimal = (value: bigint) => `${value / scale}.${String(value % scale).padStart(12, "0")}`.replace(/\.?0+$/, "");

export function parseLengthInput(input: string, unit: LengthUnit): { metres: number; error?: never } | { metres?: never; error: string } {
  if (!Object.hasOwn(factors, unit)) return { error: "Choose a supported length unit." };
  const match = /^(?:(\d{1,12})(?:\.(\d{0,12}))?|\.(\d{1,12}))$/.exec(input.trim());
  if (!match) return { error: "Enter a positive decimal length, with at most 12 decimal places." };
  const amount = BigInt(match[1] ?? "0") * scale + BigInt((match[2] ?? match[3] ?? "").padEnd(12, "0"));
  const [numerator, denominator] = factors[unit];
  const metres = rounded(amount * numerator, denominator);
  if (metres <= BigInt(0) || metres > BigInt(1000) * scale) return { error: "Cut length must be above zero and at most 1,000 metres." };
  return { metres: Number(decimal(metres)) };
}

// AP-040: one length field accepts what the customer said ("21ft", "6.4m", "6400", "12' 6\"", "12ft 6in", "640cm") and
// returns the exact metres (the stored value) and millimetres to show beside the input. A bare number is millimetres.
export type ParsedLengthText = { metres: number; mm: number; read_as: string; original: string; warning?: string; error?: never } | { error: string; metres?: never };

const DECIMAL = "(\\d{1,12}(?:\\.\\d{0,12})?|\\.\\d{1,12})";
const FEET = "(?:ft|feet|foot|')";
const INCH = "(?:in|inch|inches|\"|'')";
const unitPatterns: [RegExp, (m: RegExpExecArray) => { amount: string; unit: LengthUnit | "cm"; label: string }][] = [
  [new RegExp(`^${DECIMAL}\\s*${FEET}\\s*${DECIMAL}\\s*${INCH}?$`, "i"), m => ({ amount: addFeetInches(m[1], m[2]), unit: "in", label: `${m[1]} ft ${m[2]} in` })],
  [new RegExp(`^${DECIMAL}\\s*${FEET}$`, "i"), m => ({ amount: m[1], unit: "ft", label: `${m[1]} ft` })],
  [new RegExp(`^${DECIMAL}\\s*${INCH}$`, "i"), m => ({ amount: m[1], unit: "in", label: `${m[1]} in` })],
  [new RegExp(`^${DECIMAL}\\s*(?:mm|millimetres?|millimeters?)$`, "i"), m => ({ amount: m[1], unit: "mm", label: `${m[1]} mm` })],
  [new RegExp(`^${DECIMAL}\\s*(?:cm|centimetres?|centimeters?)$`, "i"), m => ({ amount: m[1], unit: "cm", label: `${m[1]} cm` })],
  [new RegExp(`^${DECIMAL}\\s*(?:m|mtr|mtrs|metres?|meters?)$`, "i"), m => ({ amount: m[1], unit: "m", label: `${m[1]} m` })],
  [new RegExp(`^${DECIMAL}$`), m => ({ amount: m[1], unit: "mm", label: `${m[1]} mm (no unit: read as millimetres)` })]
];

const toScaled = (value: string) => {
  const [whole, fraction = ""] = value.startsWith(".") ? ["0", value.slice(1)] : value.split(".");
  return BigInt(whole || "0") * scale + BigInt(fraction.padEnd(12, "0").slice(0, 12));
};
function addFeetInches(feet: string, inches: string) {
  return decimal(toScaled(feet) * BigInt(12) + toScaled(inches)) || "0";
}

export function parseLengthText(input: string): ParsedLengthText {
  const original = String(input ?? "").trim().replace(/\s+/g, " ");
  if (!original) return { error: "Enter the length, for example 6400, 6.4m, 21ft or 12' 6\"." };
  if (original.length > 40) return { error: "Keep the length within 40 characters." };
  const normalised = original.replace(/[’′]/g, "'").replace(/[”″]/g, "\"").replace(/,/g, "");
  for (const [pattern, read] of unitPatterns) {
    const match = pattern.exec(normalised);
    if (!match) continue;
    const { amount, unit, label } = read(match);
    const parsed = unit === "cm" ? parseLengthInput(decimal(toScaled(amount) / BigInt(100)) || "0", "m") : parseLengthInput(amount, unit);
    if (parsed.error !== undefined) return { error: parsed.error.replace("Enter a positive decimal length", "Enter a positive length").replace("Cut length", "Length") };
    const mm = Math.round(parsed.metres * 1000 * 1000) / 1000;
    const bare = pattern === unitPatterns[unitPatterns.length - 1][0];
    const warning = bare && mm < 100 ? `${original} is read as ${mm} mm. Add a unit (m, ft, in) if you meant something else.` : undefined;
    return { metres: parsed.metres, mm, read_as: label, original, ...(warning ? { warning } : {}) };
  }
  return { error: "Write the length as millimetres (6400), metres (6.4m), feet (21ft), inches (250in) or feet and inches (12' 6\")." };
}

/**
 * One length field with a display-unit selector: a value with its own unit ("21ft", "6.4m", "12' 6\"") is read as
 * written; a bare number is in the selected unit, except that a bare number of 100 or more while metres are selected is
 * read as millimetres (no cut length is 100 m; "6400" means 6400 mm). The kept text always names its unit.
 */
export function parseLengthEntry(input: string, unit: LengthUnit): ParsedLengthText {
  const text = String(input ?? "").trim();
  if (/^[\d.,\s]+$/.test(text) && text) {
    const plain = text.replace(/[,\s]/g, "");
    if (unit === "m" && Number(plain) >= 100) return parseLengthText(plain);
    const parsed = parseLengthInput(plain, unit);
    if (parsed.error !== undefined) return { error: parsed.error.replace("Cut length", "Length") };
    const short = unit === "m" ? "m" : unit;
    return { metres: parsed.metres, mm: Math.round(parsed.metres * 1000 * 1000) / 1000, read_as: `${plain} ${short}`, original: `${plain} ${short}` };
  }
  return parseLengthText(text);
}

export function displayLength(metres: number, unit: LengthUnit): string {
  if (!Object.hasOwn(factors, unit) || !Number.isFinite(metres) || metres < 0 || metres > 1000) return "";
  const [whole, fraction] = metres.toFixed(12).split(".");
  const amount = BigInt(whole) * scale + BigInt(fraction);
  const [numerator, denominator] = factors[unit];
  return decimal(rounded(amount * denominator, numerator));
}
