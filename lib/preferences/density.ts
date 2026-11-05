// NOV-082: a display-density preference. It is a per-device, per-user convenience, not a permission and not a
// different business mode; it never changes row counts, pagination or what data is loaded.
export type Density = "comfortable" | "compact";
export const DENSITIES: readonly Density[] = ["comfortable", "compact"];
export const DEFAULT_DENSITY: Density = "comfortable";

/** The token values the stylesheet applies. Compact never applies on touch screens (pointer: coarse). */
export const DENSITY_TOKENS: Record<Density, { controlPadding: string; rowPadding: string; gap: string }> = {
  comfortable: { controlPadding: "0.625rem", rowPadding: "1rem", gap: "1rem" },
  compact: { controlPadding: "0.375rem", rowPadding: "0.5rem", gap: "0.625rem" }
};

export type DensityScope = { companyId: string; userId: string };
export function densityKey(scope: DensityScope) { return `extrusionos:density:v1:${scope.companyId}:${scope.userId}`; }
export function parseDensity(value: unknown): Density { return value === "compact" ? "compact" : DEFAULT_DENSITY; }

type ReadStore = Pick<Storage, "getItem"> | null | undefined;
type WriteStore = Pick<Storage, "setItem" | "removeItem"> | null | undefined;
/** Storage can be missing or throw (private windows, blocked site data). Anything unreadable falls back to comfortable. */
export function readDensity(store: ReadStore, scope: DensityScope): Density {
  try { return parseDensity(store?.getItem(densityKey(scope))); } catch { return DEFAULT_DENSITY; }
}
export function writeDensity(store: WriteStore, scope: DensityScope, density: Density): boolean {
  try { if (!store) return false; store.setItem(densityKey(scope), density); return true; } catch { return false; }
}
export function resetDensity(store: WriteStore, scope: DensityScope): boolean {
  try { if (!store) return false; store.removeItem(densityKey(scope)); return true; } catch { return false; }
}
export function browserStore(): Storage | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage; } catch { return null; }
}
