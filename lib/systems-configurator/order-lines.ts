// AP-070: order lines from a configurator project. The cutting list says which cut lengths each profile needs; the
// customer is supplied full stock lengths, so the cuts of each profile are packed into stock lengths (first-fit,
// longest first, one saw kerf per cut). Each profile and stock length becomes one order line of whole pieces, shown with
// the free stock of that length. Hardware and other materials are listed for the order note: order lines carry profiles.

export type SystemCut = { profile_id: string | null; profile_code: string; profile_name: string; cut_length_mm: number; quantity: number; stock_length_mm: number; kg_per_m: number | null };
export type FreeStock = { pieces: number; kg: number; lots: { finish: string; piece_length_m: number | null; pieces: number; kg: number }[] };
export type SystemProfileInfo = { profile_code: string; profile_name: string; section_weight_kg_per_m: number | null; hsn_code: string | null; is_active: boolean; free: FreeStock };
export type SystemOrderLine = {
  profile_id: string; profile_code: string; profile_name: string; stock_length_m: number; pieces: number; cuts: number; cut_m: number; offcut_m: number;
  kg_per_m: number | null; weight_kg: number | null; hsn_code: string | null; free_pieces: number; short_pieces: number;
};
export type SystemOrderDraft = { lines: SystemOrderLine[]; skipped: { profile_code: string; reason: string }[]; hardware_note: string };

const SAW_KERF_MM = 5;
const round = (value: number, digits = 3) => Math.round((value + Number.EPSILON) * 10 ** digits) / 10 ** digits;

/** Stock lengths needed for a list of cuts: first-fit decreasing with a saw kerf after every cut but the last in a bar. */
export function barsForCuts(cutsMm: number[], stockMm: number, kerfMm = SAW_KERF_MM): number {
  const bars: number[] = [];
  for (const cut of [...cutsMm].sort((a, b) => b - a)) {
    let placed = false;
    for (let index = 0; index < bars.length; index++) {
      if (bars[index] + kerfMm + cut <= stockMm + 1e-6) { bars[index] += kerfMm + cut; placed = true; break; }
    }
    if (!placed) bars.push(cut);
  }
  return bars.length;
}

export function buildSystemOrderLines(cuts: SystemCut[], profiles: Record<string, SystemProfileInfo>, finish = "mill_finish"): Pick<SystemOrderDraft, "lines" | "skipped"> {
  const skipped: SystemOrderDraft["skipped"] = [];
  const groups = new Map<string, { profile_id: string; stock_mm: number; cuts: number[]; code: string; name: string; kgm: number | null }>();
  for (const cut of cuts) {
    if (!cut.profile_id) { skipped.push({ profile_code: cut.profile_code, reason: "Not linked to a profile in the catalogue" }); continue; }
    const info = profiles[cut.profile_id];
    if (!info?.is_active) { skipped.push({ profile_code: cut.profile_code, reason: "The profile is inactive" }); continue; }
    if (!(cut.cut_length_mm > 0) || !Number.isInteger(cut.quantity) || cut.quantity < 1) { skipped.push({ profile_code: cut.profile_code, reason: "The cut has no length or quantity" }); continue; }
    if (!(cut.stock_length_mm > 0) || cut.cut_length_mm > cut.stock_length_mm) { skipped.push({ profile_code: cut.profile_code, reason: `A ${cut.cut_length_mm} mm cut does not fit the ${cut.stock_length_mm} mm stock length` }); continue; }
    const key = `${cut.profile_id}|${cut.stock_length_mm}`;
    const group = groups.get(key) ?? { profile_id: cut.profile_id, stock_mm: cut.stock_length_mm, cuts: [], code: info.profile_code, name: info.profile_name, kgm: info.section_weight_kg_per_m ?? cut.kg_per_m };
    for (let n = 0; n < cut.quantity && group.cuts.length < 20000; n++) group.cuts.push(cut.cut_length_mm);
    groups.set(key, group);
  }
  const lines: SystemOrderLine[] = [];
  for (const group of groups.values()) {
    const pieces = barsForCuts(group.cuts, group.stock_mm);
    const stockM = round(group.stock_mm / 1000);
    const cutM = round(group.cuts.reduce((sum, mm) => sum + mm, 0) / 1000);
    const info = profiles[group.profile_id];
    const free = (info?.free.lots ?? []).filter(lot => lot.finish === finish && lot.piece_length_m !== null && Math.abs(lot.piece_length_m - stockM) < 0.0015).reduce((sum, lot) => sum + lot.pieces, 0);
    lines.push({ profile_id: group.profile_id, profile_code: group.code, profile_name: group.name, stock_length_m: stockM, pieces, cuts: group.cuts.length, cut_m: cutM,
      offcut_m: round(pieces * stockM - cutM), kg_per_m: group.kgm, weight_kg: group.kgm ? round(pieces * stockM * group.kgm) : null, hsn_code: info?.hsn_code ?? null,
      free_pieces: free, short_pieces: Math.max(pieces - free, 0) });
  }
  lines.sort((a, b) => a.profile_code.localeCompare(b.profile_code) || a.stock_length_m - b.stock_length_m);
  return { lines, skipped };
}

/** Hardware and other materials as plain text for the order note (they are not order lines). */
export function hardwareNote(project: { number: string | null; project_name: string | null }, hardware: { item_code: string; item_name: string; quantity: number; unit: string }[],
  materials: { material_type: string; item_name: string; quantity: number; unit: string }[]): string {
  const head = `From configurator project ${project.number ?? ""}${project.project_name ? ` (${project.project_name})` : ""}.`.replace(/\s+\./, ".");
  const parts = [head];
  if (hardware.length) parts.push(`Hardware: ${hardware.slice(0, 40).map(h => `${h.item_code} ${h.item_name} x ${round(h.quantity, 2)} ${h.unit}`).join("; ")}.`);
  if (materials.length) parts.push(`Other materials: ${materials.slice(0, 40).map(m => `${m.item_name} x ${round(m.quantity, 2)} ${m.unit}`).join("; ")}.`);
  return parts.join(" ").slice(0, 1900);
}
