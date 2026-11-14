// AP-020: read a billet mill test certificate's text into a reviewable draft. Every field carries its confidence and the
// line it came from; anything that cannot be read stays blank (never zero). A supplier template adds that supplier's
// labels and the column order of its chemistry table. Nothing here accepts material: a person confirms the values.

export const MTC_FIELD_KEYS = ["heat_number", "alloy", "si", "fe", "cu", "mn", "mg", "zn", "ti"] as const;
export type MtcFieldKey = (typeof MTC_FIELD_KEYS)[number];
export type Confidence = "high" | "medium" | "low";
export type ExtractedField = { value: string | number | null; confidence: Confidence | null; source: string | null };
export type MtcExtraction = Record<MtcFieldKey, ExtractedField>;
export type MtcTemplate = { heat_labels?: string[]; alloy_labels?: string[]; element_order?: string[]; decimal_comma?: boolean } | null | undefined;

const ELEMENTS = [
  ["si", "Si", "Silicon"], ["fe", "Fe", "Iron"], ["cu", "Cu", "Copper"], ["mn", "Mn", "Manganese"],
  ["mg", "Mg", "Magnesium"], ["zn", "Zn", "Zinc"], ["ti", "Ti", "Titanium"]
] as const;
type ElementKey = (typeof ELEMENTS)[number][0];
const KNOWN_ALLOYS = ["6063", "6061", "6082", "6005", "6060", "6463", "1050", "1060", "1100", "3003"];
const DEFAULT_HEAT_LABELS = ["heat no", "heat number", "heat", "cast no", "cast number", "cast", "melt no"];
const WEAK_HEAT_LABELS = ["lot no", "lot number", "batch no", "batch number"];
const DEFAULT_ALLOY_LABELS = ["alloy grade", "alloy", "grade", "material grade", "material"];
/** Lines that state the specification rather than the result. */
const SPEC_LINE = /\b(min(imum)?|max(imum)?|spec(ification)?|limit|range|std|standard|required)\b/i;
const RESULT_LINE = /\b(actual|result|observed|analysis|found|heat|cast)\b/i;

const blank = (): ExtractedField => ({ value: null, confidence: null, source: null });
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*");
const snippet = (line: string) => line.trim().slice(0, 160);

/** One certificate's text, normalised: one line per row, single spaces, decimal commas turned into points when asked. */
export function normaliseCertificateText(text: string, decimalComma = false) {
  let value = String(text ?? "").replace(/\r\n?/g, "\n").replace(/[   \t]/g, " ").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ");
  if (decimalComma) value = value.replace(/(\d),(\d)/g, "$1.$2");
  return value.split("\n").map(line => line.replace(/ {2,}/g, " ").trim()).filter(Boolean);
}

/** Numeric tokens of a line that look like a % composition (0 to 20, optional leading zero). */
function percents(line: string) {
  return [...line.matchAll(/(?<![\w.])(\d{1,2}(?:\.\d{1,4})?|\.\d{1,4})(?![\w.])/g)].map(m => Number(m[1])).filter(v => Number.isFinite(v) && v >= 0 && v <= 20);
}

function findHeat(lines: string[], template: MtcTemplate): ExtractedField {
  const groups: [string[], Confidence][] = [[template?.heat_labels ?? [], "high"], [DEFAULT_HEAT_LABELS, "high"], [WEAK_HEAT_LABELS, "medium"]];
  for (const [labels, confidence] of groups) {
    for (const label of [...labels].sort((a, b) => b.length - a.length)) {
      const re = new RegExp(`(?:^|[^A-Za-z])${escapeRe(label)}\\.?\\s*(?:no\\.?|number)?\\s*[:#.\\-]?\\s*([A-Z0-9][A-Z0-9/_-]{1,39})`, "i");
      for (const line of lines) {
        const m = re.exec(line);
        if (m && /\d/.test(m[1]) && !/^(19|20)\d\d-\d\d-\d\d$/.test(m[1])) return { value: m[1].toUpperCase(), confidence, source: snippet(line) };
      }
    }
  }
  return blank();
}

function findAlloy(lines: string[], template: MtcTemplate): ExtractedField {
  for (const label of [...(template?.alloy_labels ?? []), ...DEFAULT_ALLOY_LABELS]) {
    const re = new RegExp(`(?:^|[^A-Za-z])${escapeRe(label)}\\s*[:#.\\-]?\\s*(?:AA|EN AW-?|AL)?\\s*([0-9]{4})([A-Z])?\\b`, "i");
    for (const line of lines) {
      const m = re.exec(line);
      if (m) return { value: m[1] + (m[2] && !/^T$/i.test(m[2]) ? m[2].toUpperCase() : ""), confidence: "high", source: snippet(line) };
    }
  }
  const found = new Map<string, string>();
  for (const line of lines) for (const m of line.matchAll(/(?<!\d)(\d{4})(?!\d)/g)) if (KNOWN_ALLOYS.includes(m[1]) && !found.has(m[1])) found.set(m[1], line);
  if (found.size === 1) { const [[alloy, line]] = [...found]; return { value: alloy, confidence: "medium", source: snippet(line) }; }
  return blank();
}

/** A row of element symbols (Si Fe Cu …) and the result row under it. */
function fromTable(lines: string[], template: MtcTemplate): Partial<Record<MtcFieldKey, ExtractedField>> {
  const out: Partial<Record<MtcFieldKey, ExtractedField>> = {};
  const symbol = (token: string): ElementKey | "other" | null => ELEMENTS.find(([, s, name]) => token.toLowerCase() === s.toLowerCase() || token.toLowerCase() === name.toLowerCase())?.[0] ?? (/^(cr|al|others?|ni|pb|v|ga|b)$/i.test(token) ? "other" : null);
  let order: (ElementKey | "other")[] | null = null; let headerAt = -1;
  for (const [index, line] of lines.entries()) {
    const tokens = line.split(/[\s|,;]+/).map(t => t.replace(/[%():.]/g, "")).filter(Boolean);
    const mapped = tokens.map(symbol);
    if (mapped.filter(x => x && x !== "other").length >= 4 && mapped.filter(Boolean).length >= tokens.length - 2) {
      order = mapped.filter((x): x is ElementKey | "other" => x !== null); headerAt = index; break;
    }
  }
  let confidence: Confidence = "medium";
  if (!order && template?.element_order?.length) {
    order = template.element_order.map(e => ELEMENTS.find(([, s]) => s === e)?.[0] ?? "other");
    confidence = "medium";
  } else if (order && template?.element_order?.length) confidence = "high";
  if (!order) return out;
  const candidates = lines.slice(headerAt + 1).filter(line => percents(line).length >= order.length && !SPEC_LINE.test(line));
  const row = candidates.find(line => RESULT_LINE.test(line)) ?? candidates[0];
  if (!row) return out;
  const values = percents(row).slice(-order.length);
  order.forEach((key, i) => { if (key !== "other" && values[i] !== undefined) out[key] = { value: values[i], confidence, source: snippet(row) }; });
  return out;
}

/** "Si: 0.42", "Magnesium 0.51 %" on result lines. */
function fromPairs(lines: string[], key: MtcFieldKey): ExtractedField {
  const [, s, name] = ELEMENTS.find(([k]) => k === key)!;
  const re = new RegExp(`(?:^|[^A-Za-z])(?:${s}|${name})(?![a-z])\\s*(?:\\(%\\)|%|wt\\.?%)?\\s*[:=\\-]?\\s*(\\d{1,2}(?:\\.\\d{1,4})?|\\.\\d{1,4})(?![\\d.])`);
  const hits = lines.map(line => ({ line, m: re.exec(line) })).filter(h => h.m && Number(h.m[1]) <= 20);
  const result = hits.find(h => !SPEC_LINE.test(h.line));
  if (result) return { value: Number(result.m![1]), confidence: hits.length === 1 ? "high" : "medium", source: snippet(result.line) };
  if (hits.length) return { value: Number(hits[0].m![1]), confidence: "low", source: snippet(hits[0].line) };
  return blank();
}

export function extractMtc(text: string, template?: MtcTemplate): MtcExtraction {
  const lines = normaliseCertificateText(text, Boolean(template?.decimal_comma));
  const table = fromTable(lines, template);
  const result = { heat_number: findHeat(lines, template), alloy: findAlloy(lines, template) } as MtcExtraction;
  for (const [key] of ELEMENTS) result[key] = table[key] ?? fromPairs(lines, key);
  return result;
}

/** How much of the certificate was read: fields with a value, and the low-confidence ones a person should check first. */
export function extractionSummary(extraction: MtcExtraction) {
  const read = MTC_FIELD_KEYS.filter(k => extraction[k].value !== null && extraction[k].value !== "");
  return { read: read.length, total: MTC_FIELD_KEYS.length, check: MTC_FIELD_KEYS.filter(k => extraction[k].confidence === "low" || extraction[k].value === null) };
}
