// AP-035: bundle packing standard. Mirrors private.ap4_pack_line and private.ap4_pack_materials (parity test in
// tests/autopilot-batch4.test.mjs). Blank stays blank: without a limit from the customer spec or the profile there is
// no proposal, and a missing length or kg/m never becomes zero.

export type PackLineInput = {
  pieces: number | null;
  lengthM: number | null;
  kgPerM: number | null;
  maxBundleKg: number | null;
  maxPieces: number | null;
  profilePerBundle: number | null;
};

export type PackLine = {
  pieceKg: number | null;
  perBundle: number | null;
  basis: "max_pieces" | "max_kg" | "profile_standard" | null;
  bundles: number | null;
  lastBundlePieces: number | null;
  bundleKg: number | null;
  heavyPiece: boolean;
};

const round = (value: number, places: number) => {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};
const positive = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

export function packLine(input: PackLineInput): PackLine {
  const pieceKg = positive(input.lengthM) && positive(input.kgPerM) ? round(input.lengthM * input.kgPerM, 4) : null;
  const byKg = positive(input.maxBundleKg) && pieceKg !== null ? Math.floor(input.maxBundleKg / pieceKg) : null;
  let perBundle: number | null = null;
  let basis: PackLine["basis"] = null;
  if (positive(input.maxPieces)) { perBundle = Math.trunc(input.maxPieces); basis = "max_pieces"; }
  if (byKg !== null && (perBundle === null || byKg < perBundle)) { perBundle = byKg; basis = "max_kg"; }
  if (positive(input.profilePerBundle) && (perBundle === null || input.profilePerBundle < perBundle)) { perBundle = Math.trunc(input.profilePerBundle); basis = "profile_standard"; }
  let heavyPiece = false;
  if (perBundle !== null && perBundle < 1) { perBundle = 1; heavyPiece = true; }
  let bundles: number | null = null;
  let lastBundlePieces: number | null = null;
  if (perBundle !== null && positive(input.pieces)) {
    bundles = Math.ceil(input.pieces / perBundle);
    lastBundlePieces = input.pieces - (bundles - 1) * perBundle;
  }
  return { pieceKg, perBundle, basis, bundles, lastBundlePieces, bundleKg: perBundle !== null && pieceKg !== null ? round(perBundle * pieceKg, 3) : null, heavyPiece };
}

export type PackagingMaterial = { id: string; code: string; name: string; unit: string; method: "per_profile_meter" | "per_piece" | "per_kg" | "fixed"; rate: number };
export type MaterialNeed = { materialId: string | null; code: string; name: string; unit: string; method: string; rate: number; quantity: number };

/** Standard material for a packed quantity. "fixed" is applied once per bundle (the packing unit); battens per bundle. */
export function packMaterials(materials: PackagingMaterial[], quantity: { pieces: number; metres: number; kg: number; bundles: number }, battensPerBundle = 0): MaterialNeed[] {
  const needs: MaterialNeed[] = [...materials].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)).map(m => ({
    materialId: m.id, code: m.code, name: m.name, unit: m.unit, method: m.method, rate: m.rate,
    quantity: round((m.method === "per_piece" ? quantity.pieces : m.method === "per_kg" ? quantity.kg : m.method === "fixed" ? quantity.bundles : quantity.metres) * m.rate, 3)
  }));
  if (battensPerBundle > 0) needs.push({ materialId: null, code: "BATTEN", name: "Wooden battens", unit: "pcs", method: "per_bundle_count", rate: battensPerBundle, quantity: battensPerBundle * quantity.bundles });
  return needs;
}

export type MaterialComparison = { code: string; name: string; unit: string; standard: number | null; issued: number | null; variance: number | null; variancePercent: number | null };

/** Standard vs issued per material (by code). A material only on one side keeps the other side blank. */
export function compareMaterials(standard: { code: string; name: string; unit: string; quantity: number }[], issued: { code: string; name: string; unit: string; quantity: number }[]): MaterialComparison[] {
  const byCode = new Map<string, MaterialComparison>();
  for (const s of standard) byCode.set(s.code, { code: s.code, name: s.name, unit: s.unit, standard: s.quantity, issued: null, variance: null, variancePercent: null });
  for (const x of issued) {
    const row = byCode.get(x.code) ?? { code: x.code, name: x.name, unit: x.unit, standard: null, issued: null, variance: null, variancePercent: null };
    row.issued = (row.issued ?? 0) + x.quantity;
    byCode.set(x.code, row);
  }
  for (const row of byCode.values()) {
    if (row.standard !== null && row.issued !== null) {
      row.variance = round(row.issued - row.standard, 3);
      row.variancePercent = row.standard > 0 ? round((100 * (row.issued - row.standard)) / row.standard, 1) : null;
    }
  }
  return [...byCode.values()].sort((a, b) => (a.code < b.code ? -1 : 1));
}

export const WRAPPING_LABELS = { stretch_film: "Stretch film", bubble_wrap: "Bubble wrap", pp_woven_sheet: "PP woven sheet", hdpe: "HDPE sheet", paper: "Paper", none: "No wrapping" } as const;
export type Wrapping = keyof typeof WRAPPING_LABELS;

/** One sentence for the packer: what the standard asks for this line. */
export function packingInstruction(line: PackLine, spec: { wrapping: Wrapping; interleavingPaper: boolean; battensPerBundle: number; maxBundleKg: number | null } | null): string {
  if (line.perBundle === null) return "No bundle limit is set for this customer or profile. Pack as instructed and record the bundle.";
  const parts = [`Pack ${line.perBundle} piece${line.perBundle === 1 ? "" : "s"} per bundle`];
  if (line.bundleKg !== null) parts[0] += ` (about ${line.bundleKg} kg)`;
  if (line.bundles !== null) parts.push(`${line.bundles} bundle${line.bundles === 1 ? "" : "s"}${line.lastBundlePieces !== null && line.lastBundlePieces !== line.perBundle ? `, last one ${line.lastBundlePieces} pcs` : ""}`);
  if (spec) {
    if (spec.wrapping !== "none") parts.push(WRAPPING_LABELS[spec.wrapping].toLowerCase());
    if (spec.interleavingPaper) parts.push("interleaving paper between pieces");
    if (spec.battensPerBundle > 0) parts.push(`${spec.battensPerBundle} wooden batten${spec.battensPerBundle === 1 ? "" : "s"}`);
  }
  if (line.heavyPiece) parts.push("one piece is heavier than the bundle limit");
  return `${parts.join("; ")}.`;
}
