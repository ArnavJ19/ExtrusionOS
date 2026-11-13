// AP-027: actual section weight from weighed bundles, mirrored by private.ap6_die_drift (a test compares them).
// A bundle's kg/m is its net weight over its net length. The newest N bundles of a die are averaged and compared with
// the profile master's theoretical kg/m. Missing master weight or tolerance leaves the state unknown, never "within".

export type DriftState = "heavy" | "light" | "within" | "insufficient" | "no_theoretical" | "no_tolerance";
export type BundleWeight = { gross_weight_kg: number; tare_weight_kg: number; net_length_m: number };

export function bundleKgPerM(bundle: BundleWeight): number | null {
  const net = bundle.gross_weight_kg - bundle.tare_weight_kg;
  if (!(bundle.net_length_m > 0) || !(bundle.tare_weight_kg >= 0) || !(net > 0)) return null;
  return Math.round(net / bundle.net_length_m * 10000) / 10000;
}

export function sectionWeightDrift(input: { newestFirst: BundleWeight[]; theoreticalKgPerM: number | null; tolerancePercent: number | null; windowBundles?: number; minBundles?: number }) {
  const window = input.windowBundles ?? 10, min = input.minBundles ?? 3;
  const points = input.newestFirst.map(bundleKgPerM).filter((v): v is number => v !== null).slice(0, window);
  const actual = points.length ? Math.round(points.reduce((s, v) => s + v, 0) / points.length * 10000) / 10000 : null;
  const theo = input.theoreticalKgPerM;
  if (!theo || theo <= 0) return { state: "no_theoretical" as DriftState, actual, drift: null, used: points.length };
  if (points.length < min || actual === null) return { state: "insufficient" as DriftState, actual, drift: null, used: points.length };
  const drift = Math.round((actual - theo) / theo * 100 * 1000) / 1000;
  const tol = input.tolerancePercent;
  const state: DriftState = tol === null || !(tol > 0) ? "no_tolerance" : drift > tol ? "heavy" : drift < -tol ? "light" : "within";
  return { state, actual, drift, used: points.length };
}
