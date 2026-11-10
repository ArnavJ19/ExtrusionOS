// AP-012 / AP-013: what one billet yields at the press under an approved scrap standard.
// Mirrors private.ap2_push_yield (the database is authoritative for anything that posts; a test compares the two).
// Every part is null when an input is missing, so an unknown never becomes zero.
//   butt    = butt length x billet cross-section x density
//   crops   = (front + back crop length) x kg/m
//   pieces  = whole cut lengths (plus one saw kerf each) in what remains
//   saw     = pieces x kerf x kg/m
//   cut-off = the remainder, so butt + crops + saw + good + cut-off = billet kg exactly

export type ScrapStandardInput = {
  buttLengthMm: number | null;
  frontCropMm: number | null;
  backCropMm: number | null;
  sawKerfMm: number | null;
  densityKgM3: number | null;
};

export type PushYieldInput = ScrapStandardInput & {
  billetKg: number | null;
  billetDiameterMm: number | null;
  kgPerM: number | null;
  cutM: number | null;
};

export type PushYield = { buttKg: number; cropKg: number; sawKg: number; goodKg: number; cutoffKg: number; pieces: number };

const round3 = (value: number) => Math.round((value + Number.EPSILON) * 1000) / 1000;
const positive = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

export function pushYield(input: PushYieldInput): PushYield | null {
  const { billetKg, billetDiameterMm, kgPerM, cutM, buttLengthMm, densityKgM3 } = input;
  if (!positive(billetKg) || !positive(billetDiameterMm) || !positive(kgPerM) || !positive(cutM) || buttLengthMm == null || !Number.isFinite(buttLengthMm) || !positive(densityKgM3)) return null;
  const kerfMm = input.sawKerfMm ?? 0;
  const buttKg = round3(Math.min(billetKg, (Math.PI / 4) * billetDiameterMm * billetDiameterMm * buttLengthMm * densityKgM3 / 1e9));
  const extrudedKg = billetKg - buttKg;
  const cropKg = round3(Math.min(extrudedKg, ((input.frontCropMm ?? 0) + (input.backCropMm ?? 0)) / 1000 * kgPerM));
  const usableM = Math.max(0, (extrudedKg - cropKg) / kgPerM);
  const pieces = Math.floor(usableM / (cutM + kerfMm / 1000) + 1e-9);
  const sawKg = round3(pieces * kerfMm / 1000 * kgPerM);
  let goodKg = round3(pieces * cutM * kgPerM);
  if (buttKg + cropKg + sawKg + goodKg > billetKg) goodKg = billetKg - buttKg - cropKg - sawKg;
  return { buttKg, cropKg, sawKg, goodKg, cutoffKg: round3(billetKg - buttKg - cropKg - sawKg - goodKg), pieces };
}

/** Billet weight from diameter and length when no billet is linked; always shown as "estimated". */
export function estimatedBilletKg(diameterMm: number | null, lengthMm: number | null, densityKgM3: number | null): number | null {
  if (!positive(diameterMm) || !positive(lengthMm) || !positive(densityKgM3)) return null;
  return round3((Math.PI / 4) * diameterMm * diameterMm * lengthMm * densityKgM3 / 1e9);
}

/** Full bundles and loose pieces; null when pieces per bundle is not recorded. */
export function bundleSplit(pieces: number, piecesPerBundle: number | null) {
  if (!Number.isSafeInteger(pieces) || pieces < 0 || !piecesPerBundle || !Number.isSafeInteger(piecesPerBundle) || piecesPerBundle <= 0) return null;
  return { perBundle: piecesPerBundle, full: Math.floor(pieces / piecesPerBundle), loose: pieces % piecesPerBundle };
}

/** Recovery % = good output kg / billet kg; null when either is unknown. */
export function recoveryPercent(goodKg: number | null, billetKg: number | null) {
  if (!positive(goodKg) || !positive(billetKg)) return null;
  return Math.round(goodKg * 10000 / billetKg) / 100;
}

/** Expected good output after the person enters rejects (mirrors private.ap2_apply_expected). */
export function outputAfterRejects(input: { expectedPieces: number; cutM: number; kgPerM: number; rejectPieces: number; rejectKg?: number | null; goodPieces?: number | null; goodKg?: number | null }) {
  const pieceKg = input.cutM * input.kgPerM;
  const goodPieces = input.goodPieces ?? input.expectedPieces - input.rejectPieces;
  if (!Number.isFinite(pieceKg) || pieceKg <= 0 || !Number.isSafeInteger(goodPieces) || goodPieces < 0) return null;
  const goodKg = input.goodKg ?? round3(goodPieces * pieceKg);
  const rejectKg = input.rejectKg ?? round3(input.rejectPieces * pieceKg);
  return { goodPieces, goodKg, rejectKg };
}
