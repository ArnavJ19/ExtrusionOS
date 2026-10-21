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

export function displayLength(metres: number, unit: LengthUnit): string {
  if (!Object.hasOwn(factors, unit) || !Number.isFinite(metres) || metres < 0 || metres > 1000) return "";
  const [whole, fraction] = metres.toFixed(12).split(".");
  const amount = BigInt(whole) * scale + BigInt(fraction);
  const [numerator, denominator] = factors[unit];
  return decimal(rounded(amount * denominator, numerator));
}
