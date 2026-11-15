// AP-008: a deterministic reader for WhatsApp enquiries ("OM-4521 6.4 mtr 200 pcs RAL 9010, 2045 mill 100 pcs").
// It splits the message into lines, finds the profile code, length (any unit, AP-040), quantity in pieces or kg, finish
// and shade, and says how sure it is about each line. It never prices anything and never guesses a value it did not
// read: what it could not read stays null and the line is marked low confidence. Profile codes are resolved afterwards
// against the master, the customer's aliases and remembered mappings (database gateway ap_enquiry "context").
import { parseLengthText } from "../calculations/length-units.ts";

export type Confidence = "high" | "medium" | "low";
export type ParsedEnquiryLine = {
  seq: number; text: string; code: string | null; code_key: string | null; length_m: number | null; length_text: string | null;
  pieces: number | null; kg: number | null; finish: string | null; shade: string | null; alloy: string | null; issues: string[];
};
export type ParsedEnquiry = { source: "paste" | "chat_export"; sender_phone: string | null; sender_name: string | null; body: string; lines: ParsedEnquiryLine[] };
export type CodeResolution = { code_key: string; profile_id: string | null; profile_code?: string; section_weight_kg_per_m?: number; basis?: string; candidates?: { profile_id: string; profile_code: string }[] };
export type ResolvedEnquiryLine = ParsedEnquiryLine & { profile_id: string | null; profile_code: string | null; basis: string | null; confidence: Confidence };

/** Capitals and digits only, as private.ap9_code_key. */
export function codeKey(value: string | null | undefined): string | null {
  const key = String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return key ? key.slice(0, 40) : null;
}

// WhatsApp chat exports: "12/11/26, 10:15 - Ramesh: text" (Android) and "[12/11/2026, 10:15:20] +91 98765 43210: text" (iPhone).
const EXPORT_LINE = /^\[?(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp][Mm])?)\]?\s*(?:-\s*)?([^:]{1,60}):\s?(.*)$/;
const SYSTEM_TEXT = /(messages and calls are end-to-end encrypted|<media omitted>|this message was deleted|image omitted|missed voice call)/i;

function digitsOf(value: string) { return value.replace(/\D/g, ""); }

/** Pulls the sender and the message text out of a pasted chat export; plain pasted text is returned as it is. */
export function readChatText(raw: string): Pick<ParsedEnquiry, "source" | "sender_phone" | "sender_name" | "body"> {
  const lines = String(raw ?? "").replace(/\r\n?/g, "\n").replace(/[‎‏‪-‮]/g, "").split("\n");
  let sender: string | null = null; let exported = false; const body: string[] = [];
  for (const line of lines) {
    const match = EXPORT_LINE.exec(line.trim());
    if (match) {
      exported = true;
      if (SYSTEM_TEXT.test(match[4])) continue;
      sender ??= match[3].trim();
      if (match[3].trim() !== sender) continue; // replies from Omalco staff in the same export are not the enquiry
      body.push(match[4]);
    } else if (exported && body.length && line.trim()) {
      body.push(line); // a multi-line message continues without a header
    } else if (!exported) body.push(line);
  }
  const phone = sender && /^[+\d][\d\s-]{8,}$/.test(sender) ? digitsOf(sender) : null;
  return { source: exported ? "chat_export" : "paste", sender_phone: phone && phone.length >= 10 && phone.length <= 13 ? phone : null,
    sender_name: sender && !phone ? sender.slice(0, 80) : null, body: body.join("\n").trim() };
}

const FINISHES: [RegExp, string][] = [
  [/\b(?:pvdf)\b/i, "pvdf"],
  [/\bwood\s*grain\b/i, "wood_grain"],
  [/\bwood(?:en)?\s*(?:finish|coat(?:ed|ing)?)?\b/i, "wood_finish"],
  [/\b(?:anod(?:i[sz]ed?|i[sz]ing)?|anodi[sz]ed)\b/i, "anodizing"],
  [/\b(?:ral\s?\d{4}|powder(?:\s*coat(?:ed|ing)?)?|p\.?\s?c\.?|coated)\b/i, "powder_coating"],
  [/\bmill(?:\s*finish)?\b/i, "mill_finish"]
];
const SHADES = /\b(ral\s?\d{4}|silver|champagne|bronze|black|white|ivory|grey|gray|golden|gold|natural|brown|sky blue|walnut|teak)\b/i;
const LENGTH = /(\d{1,5}(?:\.\d{1,3})?)\s*(?:'\s*(\d{1,2})\s*(?:"|in(?:ch(?:es)?)?)?|(mm|cm|mtrs?|meters?|metres?|m|ft|feet|foot|'|in(?:ch(?:es)?)?|"))(?![a-z])/i;
const FEET_INCHES = /(\d{1,3})\s*(?:ft|feet|foot|')\s*(\d{1,2}(?:\.\d)?)\s*(?:in|inch|inches|"|'')(?![a-z])/i;
const PIECES = /(\d{1,6})\s*(?:pcs?|pieces?|nos?|numbers?|lengths?|len|pc|sticks?|bars?)\b\.?/i;
const KG = /(\d{1,7}(?:\.\d{1,3})?)\s*(?:kgs?|kilo(?:gram)?s?)\b/i;
const TONNE = /(\d{1,4}(?:\.\d{1,3})?)\s*(?:tons?|tonnes?|mt)\b(?!r)/i;
// A profile code: letters then digits (OM-4521, AL 2045A, SL3020) or a bare 3-6 digit number that is not a quantity or length.
const CODE = /\b([A-Z]{1,5}\s?-?\s?\d{2,6}[A-Z]?)\b|\b(\d{3,6})\b(?!\s*(?:mm|cm|m\b|mtr|meter|metre|ft|feet|'|"|in\b|pcs?|pieces?|nos?|kgs?|kg|ton|lengths?|len))/i;
const ALLOY = /\b(?:alloy\s*)?(6063|6061|6082|6005a?|6060|1050|1100)\s*(?:alloy|t[456]\b)/i;

function cleanSegment(value: string) {
  return value.replace(/[*_~]/g, " ").replace(/\s+/g, " ").trim();
}

/** Splits the body into one segment per requested item; a segment without a code continues the item before it. */
export function splitItems(body: string): string[] {
  const raw = body.split(/\n|;|(?:,\s*)(?=[A-Za-z]{0,5}\s?-?\s?\d{3,6}\b)|\band\b(?=\s*[A-Za-z]{0,5}\s?-?\s?\d{3,6}\b)/i).map(cleanSegment).filter(Boolean);
  const items: string[] = [];
  for (const segment of raw) {
    if (/^(hi|hello|dear|sir|madam|namaste|good (?:morning|evening)|regards|thanks?|thank you|please (?:send|share|quote)|pls|kindly)[\s,!.]*$/i.test(segment)) continue;
    const withoutQuantities = segment.replace(LENGTH, " ").replace(PIECES, " ").replace(KG, " ");
    const hasCode = CODE.test(withoutQuantities), hasQuantity = LENGTH.test(segment) || PIECES.test(segment) || KG.test(segment) || TONNE.test(segment);
    // Greetings and requests ("Sir pls send rate") carry no item; a segment with a quantity but no code is still an item.
    if (!hasCode && !hasQuantity && !items.length) continue;
    if (hasCode || !items.length || (hasQuantity && PIECES.test(items[items.length - 1]) && PIECES.test(segment))) items.push(segment);
    else items[items.length - 1] = `${items[items.length - 1]}, ${segment}`;
  }
  return items.slice(0, 100);
}

/** Reads one item segment. */
export function parseItem(text: string, seq: number): ParsedEnquiryLine {
  const issues: string[] = [];
  let rest = ` ${text} `;
  let length_m: number | null = null; let length_text: string | null = null;
  const feetInches = FEET_INCHES.exec(rest);
  const lengthMatch = feetInches ? null : LENGTH.exec(rest);
  if (feetInches) {
    const parsed = parseLengthText(`${feetInches[1]}' ${feetInches[2]}"`);
    if (parsed.error === undefined && parsed.metres > 0 && parsed.metres <= 20) { length_m = parsed.metres; length_text = feetInches[0].trim(); }
    else issues.push(`Length "${feetInches[0].trim()}" could not be read`);
    rest = rest.replace(feetInches[0], " ");
  }
  if (lengthMatch) {
    const written = lengthMatch[2] !== undefined ? `${lengthMatch[1]}' ${lengthMatch[2]}"` : `${lengthMatch[1]}${lengthMatch[3] === "'" ? "ft" : lengthMatch[3] === "\"" ? "in" : lengthMatch[3]}`;
    const parsed = parseLengthText(written);
    if (parsed.error === undefined && parsed.metres > 0 && parsed.metres <= 20) { length_m = parsed.metres; length_text = lengthMatch[0].trim(); }
    else issues.push(`Length "${lengthMatch[0].trim()}" could not be read`);
    rest = rest.replace(lengthMatch[0], " ");
  }
  let pieces: number | null = null; let kg: number | null = null;
  const pcs = PIECES.exec(rest);
  if (pcs) { pieces = Number(pcs[1]); rest = rest.replace(pcs[0], " "); }
  const kgs = KG.exec(rest);
  if (kgs) { kg = Number(kgs[1]); rest = rest.replace(kgs[0], " "); }
  const tonnes = !kgs ? TONNE.exec(rest) : null;
  if (tonnes) { kg = Math.round(Number(tonnes[1]) * 1000 * 1000) / 1000; rest = rest.replace(tonnes[0], " "); }
  const alloyMatch = ALLOY.exec(rest);
  const alloy = alloyMatch ? alloyMatch[1].toUpperCase() : null;
  if (alloyMatch) rest = rest.replace(alloyMatch[0], " ");
  const finish = FINISHES.find(([pattern]) => pattern.test(rest))?.[1] ?? null;
  const shadeMatch = SHADES.exec(rest);
  const shade = shadeMatch ? shadeMatch[1].replace(/^ral\s?/i, "RAL ").replace(/\b\w/g, c => c.toUpperCase()) : null;
  const restForCode = rest.replace(/\bral\s?\d{4}\b/gi, " ");
  const codeMatch = CODE.exec(restForCode);
  const code = codeMatch ? (codeMatch[1] ?? codeMatch[2]).replace(/\s+/g, "").toUpperCase() : null;
  if (!code) issues.push("No profile code found");
  if (length_m === null && !issues.some(i => i.startsWith("Length"))) issues.push("Length not stated");
  if (pieces === null && kg === null) issues.push("Quantity not stated");
  if (!finish) issues.push("Finish not stated");
  if (finish === "powder_coating" && !shade) issues.push("Shade not stated");
  return { seq, text: text.slice(0, 300), code, code_key: codeKey(code), length_m, length_text, pieces, kg, finish, shade, alloy, issues };
}

export function parseEnquiry(raw: string): ParsedEnquiry {
  const chat = readChatText(raw);
  return { ...chat, lines: splitItems(chat.body).map((text, index) => parseItem(text, index + 1)) };
}

/**
 * Confidence after profile resolution. High: the code resolved exactly (master code, alias or remembered mapping) and
 * length, quantity and finish were all read. Medium: resolved only by its number, or the finish is missing (mill
 * finish is not assumed silently; the person confirms it). Low: no profile, or no length or quantity.
 */
export function resolveLine(line: ParsedEnquiryLine, resolution: CodeResolution | null | undefined): ResolvedEnquiryLine {
  const issues = [...line.issues];
  const profileId = resolution?.profile_id ?? null;
  if (line.code && !profileId) issues.push(resolution?.candidates?.length ? `Unknown code ${line.code}: ${resolution.candidates.length} profiles carry this number` : `Unknown code ${line.code}`);
  let confidence: Confidence = "high";
  if (!profileId || line.length_m === null || (line.pieces === null && line.kg === null)) confidence = "low";
  else if (resolution?.basis === "code_number" || !line.finish || (line.finish === "powder_coating" && !line.shade)) confidence = "medium";
  return { ...line, issues: issues.slice(0, 10), profile_id: profileId, profile_code: resolution?.profile_code ?? null, basis: resolution?.basis ?? null, confidence };
}

/** Pieces implied by a weight: kg / (length x kg per metre), rounded up. Null when it cannot be known. */
export function piecesFromKg(kg: number | null, lengthM: number | null, kgPerM: number | null | undefined): number | null {
  if (!kg || !lengthM || !kgPerM || kg <= 0 || lengthM <= 0 || kgPerM <= 0) return null;
  return Math.ceil(kg / (lengthM * kgPerM) - 1e-9);
}
