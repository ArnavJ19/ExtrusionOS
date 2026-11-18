// AP-010: reading a packing-scale indicator over a serial line (USB or RS-232 through Web Serial). Most platform-scale
// indicators sold in India send a continuous stream of ASCII lines. This module reads the common formats:
//   "ST,GS,+0012.345kg" / "US,NT,-   0.50 kg"  (stable/unstable flag, gross/net, signed value, unit)
//   "G    123.45 kg" / "N 12.3kg"              (gross/net prefix)
//   "+0012.34" / "  12.340 kg" / "12.34"       (value only; no stability flag)
// and decides when a weight is stable: the indicator says stable (when it can), and the last readings over a minimum time
// agree within the scale's resolution. Nothing here talks to the device; the screen passes in the lines it received.

export type IndicatorReading = { kg: number; stable: boolean | null; overload: boolean; gross: boolean | null; raw: string };
export type ScaleSettings = { resolutionKg: number; minStableMs: number; minReadings: number };
export const DEFAULT_SCALE: ScaleSettings = { resolutionKg: 0.05, minStableMs: 800, minReadings: 4 };
export const BAUD_RATES = [1200, 2400, 4800, 9600, 19200] as const;

const UNIT_TO_KG: Record<string, number> = { kg: 1, g: 0.001, t: 1000, lb: 0.45359237 };

/** One line from the indicator, or null when it carries no weight (blank, a header, garbage). */
export function parseIndicatorLine(line: string): IndicatorReading | null {
  const raw = String(line ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim();
  if (!raw || raw.length > 60) return null;
  let rest = raw; let stable: boolean | null = null; let gross: boolean | null = null; let overload = false;
  const flags = /^(ST|US|OL)\s*,\s*(GS|NT|TR)?\s*,?\s*/i.exec(rest);
  if (flags) {
    stable = flags[1].toUpperCase() === "ST"; overload = flags[1].toUpperCase() === "OL";
    if (flags[2]) gross = flags[2].toUpperCase() === "GS";
    rest = rest.slice(flags[0].length);
  } else {
    const prefix = /^([GN])\s+/i.exec(rest);
    if (prefix) { gross = prefix[1].toUpperCase() === "G"; rest = rest.slice(prefix[0].length); }
  }
  if (overload) return { kg: NaN, stable: false, overload: true, gross, raw };
  const value = /^([+-]?)\s*(\d{1,7}(?:\.\d{1,4})?)\s*(kg|g|t|lb)?\s*([MS?]?)$/i.exec(rest);
  if (!value) return null;
  const unit = (value[3] ?? "kg").toLowerCase();
  const kg = Number(`${value[1] === "-" ? "-" : ""}${value[2]}`) * (UNIT_TO_KG[unit] ?? 1);
  if (!Number.isFinite(kg)) return null;
  // Some indicators append "M" (motion) or "S" (stable) after the unit.
  if (value[4]?.toUpperCase() === "M") stable = false; else if (value[4]?.toUpperCase() === "S") stable = true;
  return { kg: Math.round(kg * 1000) / 1000, stable, overload: false, gross, raw };
}

/** Splits a stream of received text into complete lines; returns them and the unfinished remainder. */
export function splitStream(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split(/\r\n|\r|\n/);
  const rest = parts.pop() ?? "";
  return { lines: parts.filter(p => p.trim()), rest: rest.length > 200 ? "" : rest };
}

export type StableState = { reading: IndicatorReading | null; stable: boolean; settledKg: number | null; count: number; reason: string };

/**
 * Keeps the recent readings and reports whether the weight has settled. A weight is stable when the indicator does not
 * report motion, it is above zero, and at least minReadings readings over at least minStableMs agree within the scale's
 * resolution. A negative or overloaded reading is never stable.
 */
export class StabilityTracker {
  private readings: { at: number; r: IndicatorReading }[] = [];
  private readonly settings: ScaleSettings;
  constructor(settings: ScaleSettings = DEFAULT_SCALE) { this.settings = settings; }
  push(reading: IndicatorReading, at: number): StableState {
    this.readings.push({ at, r: reading });
    this.readings = this.readings.filter(x => at - x.at <= Math.max(this.settings.minStableMs * 4, 3000)).slice(-50);
    return this.state(at);
  }
  reset() { this.readings = []; }
  state(at: number): StableState {
    const last = this.readings[this.readings.length - 1]?.r ?? null;
    if (!last) return { reading: null, stable: false, settledKg: null, count: 0, reason: "Waiting for the scale" };
    if (last.overload) return { reading: last, stable: false, settledKg: null, count: 0, reason: "The scale is overloaded" };
    if (last.kg <= 0) return { reading: last, stable: false, settledKg: null, count: 0, reason: "Place the bundle on the scale" };
    if (last.stable === false) return { reading: last, stable: false, settledKg: null, count: 0, reason: "The scale shows motion" };
    let count = 0; let since = at;
    for (let k = this.readings.length - 1; k >= 0; k--) {
      const x = this.readings[k];
      if (x.r.overload || x.r.stable === false || Math.abs(x.r.kg - last.kg) > this.settings.resolutionKg) break;
      count++; since = x.at;
    }
    const settled = count >= this.settings.minReadings && at - since >= this.settings.minStableMs;
    return { reading: last, stable: settled, settledKg: settled ? last.kg : null, count, reason: settled ? "Stable" : "Settling" };
  }
}

/** Theoretical net weight of a bundle and how far a weighed net is from it (percent; null when it cannot be known). */
export function bundleDeviation(netKg: number, netLengthM: number, kgPerM: number | null | undefined) {
  if (!kgPerM || kgPerM <= 0 || !netLengthM || netLengthM <= 0) return { theoreticalKg: null, deviationPercent: null };
  const theoreticalKg = Math.round(netLengthM * kgPerM * 1000) / 1000;
  return { theoreticalKg, deviationPercent: Math.round(((netKg - theoreticalKg) / theoreticalKg) * 100 * 1000) / 1000 };
}
