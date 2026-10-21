export type QuotePasteProfile = {
  id: string;
  profile_code: string;
  profile_name: string;
  section_weight_kg_per_m: number | null;
  section_perimeter_mm?: number | null;
};

export type QuotePasteRow = {
  sourceRow: number;
  profileCode: string;
  lengthValue: string;
  quantityValue: string;
  finish: string;
  extraValues?: string[];
  parseError?: string;
};

export type QuotePasteRowResult = QuotePasteRow & {
  errors: string[];
  profile: QuotePasteProfile | null;
  lengthMeters: number | null;
  quantityPieces: number | null;
  normalizedFinish: "mill_finish" | "powder_coating" | "anodizing" | "wood_finish" | "pvdf" | "other" | null;
};

const maxPasteRows = 100;
const finishes = new Map([
  ["mill finish", "mill_finish"], ["mill_finish", "mill_finish"],
  ["powder coating", "powder_coating"], ["powder_coating", "powder_coating"],
  ["anodizing", "anodizing"], ["anodised", "anodizing"], ["anodized", "anodizing"],
  ["wood finish", "wood_finish"], ["wood_finish", "wood_finish"],
  ["pvdf", "pvdf"], ["other", "other"],
]);

function delimiterFor(header: string) {
  return header.includes("\t") ? "\t" : ",";
}

function splitDelimitedLine(line: string, delimiter: string): { cells: string[]; error: string | null } {
  const cells: string[] = [];
  let cell = "";
  let quoteStarted = false;
  let quoteClosed = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoteStarted && !quoteClosed && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (quoteStarted && !quoteClosed) {
        quoteClosed = true;
      } else if (!quoteStarted && cell.trim() === "") {
        quoteStarted = true;
      } else return { cells: [], error: "Quote characters must wrap a complete cell." };
    } else if (character === delimiter && (!quoteStarted || quoteClosed)) {
      cells.push(cell.trim());
      cell = "";
      quoteStarted = false;
      quoteClosed = false;
    } else if (quoteClosed && character.trim()) {
      return { cells: [], error: "Unexpected text after a closing quote." };
    } else {
      cell += character;
    }
  }
  if (quoteStarted && !quoteClosed) return { cells: [], error: "Unclosed quoted cell or line break inside a quoted cell is unsupported." };
  cells.push(cell.trim());
  return { cells, error: null };
}

function normalizedHeader(header: string) {
  return header.toLowerCase().replace(/[()]/g, " ").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

export function parseQuotePaste(text: string): { rows: QuotePasteRow[]; error: string | null } {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return { rows: [], error: "Paste a header row and at least one item row." };
  const delimiter = delimiterFor(lines[0]);
  const parsedHeaders = splitDelimitedLine(lines[0], delimiter);
  if (parsedHeaders.error) return { rows: [], error: `Header row: ${parsedHeaders.error}` };
  const headers = parsedHeaders.cells.map(normalizedHeader);
  const profileIndexes = headers.map((header, index) => ["profile code", "profile"].includes(header) ? index : -1).filter((index) => index >= 0);
  const quantityIndexes = headers.map((header, index) => ["quantity pcs", "qty pcs", "pieces", "piece count"].includes(header) ? index : -1).filter((index) => index >= 0);
  const lengthIndexes = headers.map((header, index) => ["length m", "cut length m", "length mm", "cut length mm"].includes(header) ? index : -1).filter((index) => index >= 0);
  const finishIndexes = headers.map((header, index) => header === "finish" ? index : -1).filter((index) => index >= 0);
  const profileIndex = profileIndexes[0] ?? -1;
  const qtyIndex = quantityIndexes[0] ?? -1;
  const lengthIndex = lengthIndexes[0] ?? -1;
  const finishIndex = finishIndexes[0] ?? -1;
  if (profileIndex < 0 || qtyIndex < 0 || lengthIndex < 0) {
    return { rows: [], error: "Required columns: Profile Code, Quantity (pcs), and Length (m) or Length (mm). Units must be in the header." };
  }
  if (profileIndexes.length !== 1 || quantityIndexes.length !== 1 || lengthIndexes.length !== 1 || finishIndexes.length > 1 || new Set([profileIndex, qtyIndex, lengthIndex]).size !== 3 || (finishIndex >= 0 && [profileIndex, qtyIndex, lengthIndex].includes(finishIndex))) {
    return { rows: [], error: "Column headers must be unique and unambiguous." };
  }
  if (lines.length - 1 > maxPasteRows) return { rows: [], error: `Paste up to ${maxPasteRows} lines at a time.` };
  const allowedHeaders = new Set(["profile code", "profile", "quantity pcs", "qty pcs", "pieces", "piece count", "length m", "cut length m", "length mm", "cut length mm", "finish"]);
  const unknownHeader = headers.find((header) => !allowedHeaders.has(header));
  if (unknownHeader !== undefined) return { rows: [], error: `Unsupported column "${unknownHeader || "(blank header)"}". Use only Profile Code, Quantity (pcs), Length (m or mm), and optional Finish.` };

  const rows: QuotePasteRow[] = [];
  for (const [index, line] of lines.slice(1).entries()) {
    const parsed = splitDelimitedLine(line, delimiter);
    if (parsed.error) return { rows: [], error: `Row ${index + 2}: ${parsed.error}` };
    const cells = parsed.cells;
    rows.push({
      sourceRow: index + 2,
      profileCode: cells[profileIndex] ?? "",
      lengthValue: cells[lengthIndex] ?? "",
      quantityValue: cells[qtyIndex] ?? "",
      finish: finishIndex < 0 ? "Mill finish" : cells[finishIndex] ?? "",
      extraValues: cells.length > headers.length ? cells.slice(headers.length) : [],
    });
  }
  return { rows, error: null };
}

export function getQuotePasteLengthUnit(text: string): "m" | "mm" | null {
  const firstLine = text.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] ?? "";
  const parsed = splitDelimitedLine(firstLine, delimiterFor(firstLine));
  if (parsed.error) return null;
  const headers = parsed.cells.map(normalizedHeader);
  const units = headers.filter((header) => ["length m", "cut length m", "length mm", "cut length mm"].includes(header));
  if (units.length !== 1) return null;
  return units[0].endsWith(" mm") ? "mm" : "m";
}

export function validateQuotePasteRows(
  rows: QuotePasteRow[],
  profiles: QuotePasteProfile[],
  lengthUnit: "m" | "mm",
): QuotePasteRowResult[] {
  return rows.map((row) => {
    const errors: string[] = [];
    if (row.extraValues?.length) errors.push(`Expected the declared columns, but found ${row.extraValues.length} extra cell(s).`);
    const code = row.profileCode.trim().toLocaleLowerCase();
    const matches = profiles.filter((profile) => profile.profile_code.trim().toLocaleLowerCase() === code);
    const profile = matches.length === 1 ? matches[0] : null;
    if (!row.profileCode.trim()) errors.push("Enter a profile code.");
    else if (!matches.length) errors.push("No active company profile matches this exact code.");
    else if (matches.length > 1) errors.push("This profile code is ambiguous; choose a unique canonical code.");

    const rawLength = row.lengthValue.trim();
    const parsedLength = rawLength === "" ? NaN : Number(rawLength);
    if (!Number.isFinite(parsedLength) || parsedLength <= 0) errors.push(`Enter a positive cut length in ${lengthUnit}.`);
    const lengthMeters = Number.isFinite(parsedLength) && parsedLength > 0
      ? lengthUnit === "mm" ? parsedLength / 1000 : parsedLength
      : null;

    const rawQuantity = row.quantityValue.trim();
    const parsedQuantity = rawQuantity === "" ? NaN : Number(rawQuantity);
    if (!Number.isSafeInteger(parsedQuantity) || parsedQuantity <= 0) errors.push("Enter a positive whole number of pieces.");

    const normalizedFinish = finishes.get(row.finish.trim().toLowerCase()) as QuotePasteRowResult["normalizedFinish"];
    if (!normalizedFinish) errors.push("Choose a supported finish.");
    return { ...row, errors, profile, lengthMeters, quantityPieces: Number.isSafeInteger(parsedQuantity) && parsedQuantity > 0 ? parsedQuantity : null, normalizedFinish };
  });
}

export function buildQuotePasteLine(
  base: Record<string, unknown>,
  row: QuotePasteRowResult,
): Record<string, unknown> | null {
  if (row.errors.length || !row.profile || row.lengthMeters === null || row.quantityPieces === null || !row.normalizedFinish) return null;
  const copiedIdentityFields = new Set(["id", "quote_id", "company_id", "created_at", "updated_at"]);
  return {
    ...Object.fromEntries(Object.entries(base).filter(([key]) => !copiedIdentityFields.has(key))),
    profile_id: row.profile.id,
    item_description: `${row.profile.profile_code} - ${row.profile.profile_name}`,
    quantity_pieces: row.quantityPieces,
    length_per_piece_m: row.lengthMeters,
    section_weight_kg_per_m: row.profile.section_weight_kg_per_m ?? 0,
    perimeter_mm: row.profile.section_perimeter_mm ?? null,
    finishing_type: row.normalizedFinish,
    die_id: "",
    die_charge: 0,
    die_amortization_type: "full_die_charge",
    die_amortization_quantity_kg: 0,
    minimum_billing_weight_kg: 0,
    sales_price_override: null,
  };
}

export function getQuotePasteFinishOptions(current: string) {
  const options = ["Mill finish", "Powder coating", "Anodizing", "Wood finish", "PVDF", "Other"];
  if (!current) return [{ value: "", label: "Choose finish" }, ...options.map((label) => ({ value: label, label }))];
  return options.some((option) => option === current)
    ? options.map((label) => ({ value: label, label }))
    : [{ value: current, label: `${current} (as pasted)` }, ...options.map((label) => ({ value: label, label }))];
}

export type PieceCalculationState = {
  source: "profile-master" | "manual" | "missing" | "invalid";
  message: string | null;
};

export function getPieceCalculationState(input: {
  quantityPieces: number;
  lengthPerPieceM: number;
  sectionWeightKgPerM: number | null | undefined;
  hasSelectedProfile: boolean;
  profileMasterSectionWeightKgPerM: number | null | undefined;
}): PieceCalculationState {
  const { quantityPieces, lengthPerPieceM } = input;
  if (!Number.isSafeInteger(quantityPieces) || quantityPieces <= 0 || !Number.isFinite(lengthPerPieceM) || lengthPerPieceM <= 0) {
    return { source: "invalid", message: "Enter a positive whole piece count and a positive cut length in metres." };
  }
  if (input.sectionWeightKgPerM != null && (!Number.isFinite(input.sectionWeightKgPerM) || input.sectionWeightKgPerM < 0)) {
    return { source: "invalid", message: "Section weight is invalid. Use a positive kg/m value from the company profile master or enter a valid manual value." };
  }
  if (!Number.isFinite(input.sectionWeightKgPerM) || (input.sectionWeightKgPerM ?? 0) === 0) {
    return { source: "missing", message: "Section weight is missing. Select a profile with kg/m in the company profile master or enter a valid kg/m value." };
  }
  const fromMaster = Number.isFinite(input.profileMasterSectionWeightKgPerM) && (input.profileMasterSectionWeightKgPerM ?? 0) > 0;
  const matchesProfileMaster = fromMaster && input.sectionWeightKgPerM === input.profileMasterSectionWeightKgPerM;
  return {
    source: input.hasSelectedProfile && matchesProfileMaster ? "profile-master" : "manual",
    message: input.hasSelectedProfile && !fromMaster
      ? "No kg/m is recorded in the company profile master; using the entered manual kg/m."
      : input.hasSelectedProfile && !matchesProfileMaster
        ? `Using manual ${input.sectionWeightKgPerM} kg/m; the profile master lists ${input.profileMasterSectionWeightKgPerM} kg/m.`
        : null,
  };
}
