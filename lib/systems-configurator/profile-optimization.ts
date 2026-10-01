export type OptimizationCutInput = {
  id?: string;
  profileCode: string;
  profileName: string;
  componentRole: string;
  cutLengthMm: number;
  quantity: number;
  stockLengthMm?: number;
};

export type OptimizationSettings = {
  stockLengthMm: number;
  sawKerfMm: number;
  minimumReusableLeftoverMm: number;
};

export type OptimizedCut = {
  cutId: string;
  profileCode: string;
  profileName: string;
  componentRole: string;
  cutLengthMm: number;
  kerfBeforeMm: number;
};

export type OptimizedStockBar = {
  barNumber: number;
  stockLengthMm: number;
  cuts: OptimizedCut[];
  usedLengthMm: number;
  wasteMm: number;
  reusableLeftoverMm: number;
};

export type ProfileOptimizationResult = {
  profileCode: string;
  profileName: string;
  stockLengthMm: number;
  totalStockBars: number;
  totalUsedLengthMm: number;
  totalWasteMm: number;
  wastePercent: number;
  reusableLeftoversMm: number[];
  bars: OptimizedStockBar[];
  unplacedCuts: OptimizedCut[];
  warnings: string[];
};

export type OptimizationRunResult = {
  stockLengthMm: number;
  sawKerfMm: number;
  minimumReusableLeftoverMm: number;
  profiles: ProfileOptimizationResult[];
  totalStockBars: number;
  totalUsedLengthMm: number;
  totalWasteMm: number;
  wastePercent: number;
  warnings: string[];
};

function round(value: number, digits = 3) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function expandCuts(cuts: OptimizationCutInput[]) {
  return cuts.flatMap((cut) => Array.from({ length: Math.max(0, Math.floor(cut.quantity)) }).map((_, index) => ({
    cutId: `${cut.id ?? cut.profileCode}-${cut.componentRole}-${cut.cutLengthMm}-${index + 1}`,
    profileCode: cut.profileCode,
    profileName: cut.profileName,
    componentRole: cut.componentRole,
    cutLengthMm: cut.cutLengthMm,
    kerfBeforeMm: 0
  }))).sort((a, b) => b.cutLengthMm - a.cutLengthMm);
}

export function optimizeProfileCutsForStock(cuts: OptimizationCutInput[], settings: OptimizationSettings): ProfileOptimizationResult[] {
  const grouped = new Map<string, OptimizationCutInput[]>();
  for (const cut of cuts) {
    const stockLengthMm = cut.stockLengthMm ?? settings.stockLengthMm;
    if (!Number.isFinite(stockLengthMm) || stockLengthMm <= 0) throw new Error("Stock length must be positive.");
    const key = JSON.stringify([cut.profileCode, cut.profileName, stockLengthMm]);
    grouped.set(key, [...(grouped.get(key) ?? []), cut]);
  }

  return Array.from(grouped.entries()).map(([key, profileCuts]) => {
    const [profileCode, profileName, stockLengthMm] = JSON.parse(key) as [string, string, number];
    const profileSettings = { ...settings, stockLengthMm };
    const warnings: string[] = [];
    const bars: OptimizedStockBar[] = [];
    const unplacedCuts: OptimizedCut[] = [];
    const expanded = expandCuts(profileCuts);

    for (const cut of expanded) {
      if (cut.cutLengthMm > profileSettings.stockLengthMm) {
        warnings.push(`${profileCode} cut ${cut.cutLengthMm}mm exceeds stock length ${profileSettings.stockLengthMm}mm.`);
        unplacedCuts.push(cut);
        continue;
      }

      let placed = false;
      for (const bar of bars) {
        const kerfBeforeMm = bar.cuts.length ? settings.sawKerfMm : 0;
        if (bar.usedLengthMm + kerfBeforeMm + cut.cutLengthMm <= stockLengthMm) {
          const placedCut = { ...cut, kerfBeforeMm };
          bar.cuts.push(placedCut);
          bar.usedLengthMm = round(bar.usedLengthMm + kerfBeforeMm + cut.cutLengthMm, 2);
          bar.wasteMm = round(Math.max(stockLengthMm - bar.usedLengthMm, 0), 2);
          bar.reusableLeftoverMm = bar.wasteMm >= settings.minimumReusableLeftoverMm ? bar.wasteMm : 0;
          placed = true;
          break;
        }
      }

      if (!placed) {
        const usedLengthMm = cut.cutLengthMm;
        bars.push({
          barNumber: bars.length + 1,
          stockLengthMm,
          cuts: [{ ...cut, kerfBeforeMm: 0 }],
          usedLengthMm: round(usedLengthMm, 2),
          wasteMm: round(Math.max(stockLengthMm - usedLengthMm, 0), 2),
          reusableLeftoverMm: stockLengthMm - usedLengthMm >= settings.minimumReusableLeftoverMm ? round(stockLengthMm - usedLengthMm, 2) : 0
        });
      }
    }

    for (const bar of bars) {
      const kerf = bar.cuts.reduce((sum, cut) => sum + cut.kerfBeforeMm, 0);
      bar.wasteMm = round(bar.wasteMm - bar.reusableLeftoverMm + kerf, 2);
    }
    const totalUsedLengthMm = round(bars.reduce((sum, bar) => sum + bar.cuts.reduce((length, cut) => length + cut.cutLengthMm, 0), 0), 2);
    const totalWasteMm = round(bars.reduce((sum, bar) => sum + bar.wasteMm, 0), 2);
    const totalStockLengthMm = bars.length * stockLengthMm;

    return {
      profileCode,
      profileName,
      stockLengthMm,
      totalStockBars: bars.length,
      totalUsedLengthMm,
      totalWasteMm,
      wastePercent: round(totalStockLengthMm > 0 ? (totalWasteMm / totalStockLengthMm) * 100 : 0, 3),
      reusableLeftoversMm: bars.map((bar) => bar.reusableLeftoverMm).filter((value) => value > 0),
      bars,
      unplacedCuts,
      warnings
    };
  }).sort((a, b) => a.profileCode.localeCompare(b.profileCode));
}

export function optimizeProfileCuts(cuts: OptimizationCutInput[], settings: OptimizationSettings): OptimizationRunResult {
  const profiles = optimizeProfileCutsForStock(cuts, settings);
  const totalStockBars = profiles.reduce((sum, profile) => sum + profile.totalStockBars, 0);
  const totalUsedLengthMm = round(profiles.reduce((sum, profile) => sum + profile.totalUsedLengthMm, 0), 2);
  const totalWasteMm = round(profiles.reduce((sum, profile) => sum + profile.totalWasteMm, 0), 2);
  const totalStockLengthMm = profiles.reduce((sum, profile) => sum + profile.totalStockBars * profile.stockLengthMm, 0);

  return {
    ...settings,
    profiles,
    totalStockBars,
    totalUsedLengthMm,
    totalWasteMm,
    wastePercent: round(totalStockLengthMm > 0 ? (totalWasteMm / totalStockLengthMm) * 100 : 0, 3),
    warnings: profiles.flatMap((profile) => profile.warnings)
  };
}
