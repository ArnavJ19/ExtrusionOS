// AP-029: billet length that maximises recovery for one job's cut length, within the press's billet limits.
// Mass balance per push: billet mass - butt mass = extruded mass; extruded length = extruded mass / kg per metre.
// The push must fit the run-out table; front and back crops are scrapped; whole cut pieces are good output.
// Recovery = good output / billet input. Inputs that are missing stay missing: no option is invented from zero.

export const ALUMINIUM_DENSITY_KG_M3 = 2700; // 6xxx-series wrought alloys, 2.70 g/cm³

export type BilletPress = {
  machine_id: string; machine_name?: string; min_billet_mm: number; max_billet_mm: number; standard_billet_mm: number | null;
  container_diameter_mm: number | null; butt_mm: number; runout_m: number; front_crop_m: number; back_crop_m: number; step_mm: number;
};
export type BilletJob = { kg_per_m: number | null; cut_length_m: number | null; billet_diameter_mm: number | null; extrusion_ratio: number | null };
export type BilletOption = {
  billet_mm: number; billet_kg: number; extruded_m: number; pieces: number; good_kg: number; recovery_percent: number; end_scrap_m: number;
  fits_runout: boolean; label: string;
};
export type BilletPlan =
  | { ok: true; recommended: BilletOption; standard: BilletOption | null; standard_unusable: BilletOption | null; options: BilletOption[]; gain_vs_standard: number | null; density: number; kg_per_m: number; kg_per_m_source: string }
  | { ok: false; missing: string[]; message: string };

const area = (diameterMm: number) => Math.PI / 4 * (diameterMm / 1000) ** 2;
const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;

export function evaluateBilletLength(job: Required<{ [K in keyof BilletJob]: number }> & { kg_per_m: number }, press: BilletPress, billetMm: number, density = ALUMINIUM_DENSITY_KG_M3): BilletOption {
  const billetKg = density * area(job.billet_diameter_mm) * billetMm / 1000;
  // The butt stays in the container, where the billet has upset to the container bore.
  const buttKg = density * area(press.container_diameter_mm ?? job.billet_diameter_mm) * press.butt_mm / 1000;
  const extrudedM = Math.max(0, (billetKg - buttKg) / job.kg_per_m);
  const usableM = Math.max(0, extrudedM - press.front_crop_m - press.back_crop_m);
  const pieces = Math.floor(usableM / job.cut_length_m + 1e-9);
  const goodKg = pieces * job.cut_length_m * job.kg_per_m;
  return {
    billet_mm: billetMm, billet_kg: round(billetKg, 3), extruded_m: round(extrudedM, 3), pieces, good_kg: round(goodKg, 3),
    recovery_percent: billetKg > 0 ? round(goodKg / billetKg * 100, 2) : 0, end_scrap_m: round(usableM - pieces * job.cut_length_m, 3),
    fits_runout: extrudedM <= press.runout_m + 1e-9, label: ""
  };
}

export function planBilletLength(job: BilletJob, press: BilletPress | null, density = ALUMINIUM_DENSITY_KG_M3): BilletPlan {
  const missing: string[] = [];
  if (!press) missing.push("press billet limits");
  if (!job.cut_length_m || job.cut_length_m <= 0) missing.push("cut length");
  if (!job.billet_diameter_mm || job.billet_diameter_mm <= 0) missing.push("billet diameter");
  // kg/m from the master, or from the die's extrusion ratio and the container bore when the master has none.
  let kgPerM = job.kg_per_m && job.kg_per_m > 0 ? job.kg_per_m : null;
  let source = "profile master";
  if (!kgPerM && job.extrusion_ratio && job.extrusion_ratio > 0 && press?.container_diameter_mm) {
    kgPerM = density * area(press.container_diameter_mm) / job.extrusion_ratio; source = "die extrusion ratio and container bore";
  }
  if (!kgPerM) missing.push("section weight (kg/m)");
  if (missing.length || !press || !kgPerM) return { ok: false, missing, message: `Enter the ${missing.join(", ")} to calculate billet options.` };
  if (press.container_diameter_mm && job.billet_diameter_mm! > press.container_diameter_mm) {
    return { ok: false, missing: ["a billet that fits the container"], message: "The billet diameter is larger than this press's container." };
  }
  const full = { kg_per_m: kgPerM, cut_length_m: job.cut_length_m!, billet_diameter_mm: job.billet_diameter_mm!, extrusion_ratio: job.extrusion_ratio ?? 0 };
  const step = Math.max(1, press.step_mm || 10);
  const all: BilletOption[] = [];
  for (let mm = press.min_billet_mm; mm <= press.max_billet_mm + 1e-9; mm += step) all.push(evaluateBilletLength(full, press, round(mm, 1), density));
  const valid = all.filter(o => o.fits_runout && o.pieces > 0);
  if (!valid.length) return { ok: false, missing: [], message: "No billet length within the press limits gives a whole piece that fits the run-out table." };
  const better = (a: BilletOption, b: BilletOption) => a.recovery_percent > b.recovery_percent + 1e-9 || (Math.abs(a.recovery_percent - b.recovery_percent) <= 1e-9 && (a.pieces > b.pieces || (a.pieces === b.pieces && a.billet_mm < b.billet_mm)));
  const recommended = valid.reduce((best, option) => better(option, best) ? option : best);
  // One option per piece count: the shortest billet that yields that many pieces has the least end scrap for it.
  const byPieces = new Map<number, BilletOption>();
  for (const option of valid) if (!byPieces.has(option.pieces)) byPieces.set(option.pieces, option);
  // The standard length is compared only when it can actually run on this press (fits the run-out, gives a piece).
  const exact = press.standard_billet_mm ? evaluateBilletLength(full, press, press.standard_billet_mm, density) : null;
  const standard = exact && exact.fits_runout && exact.pieces > 0 ? exact : null;
  const picked = new Map<number, BilletOption>();
  picked.set(recommended.billet_mm, { ...recommended, label: "Recommended" });
  if (standard) picked.set(standard.billet_mm, { ...standard, label: standard.billet_mm === recommended.billet_mm ? "Recommended (standard)" : "Standard length" });
  for (const option of [...byPieces.values()].sort((a, b) => b.recovery_percent - a.recovery_percent).slice(0, 6)) {
    if (!picked.has(option.billet_mm)) picked.set(option.billet_mm, { ...option, label: `${option.pieces} pieces per push` });
  }
  const options = [...picked.values()].sort((a, b) => a.billet_mm - b.billet_mm);
  return { ok: true, recommended, standard, standard_unusable: exact && !standard ? exact : null, options, gain_vs_standard: standard ? round(recommended.recovery_percent - standard.recovery_percent, 2) : null, density, kg_per_m: round(kgPerM, 4), kg_per_m_source: source };
}
