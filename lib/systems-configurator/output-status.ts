export type SystemOutputCounts = {
  profileCuts: number;
  glassCuts: number;
  beadingCuts: number;
  hardwareBom: number;
  optimizationRuns?: number;
};

export type SystemOutputStatus = {
  productionReady: boolean;
  optimizationReady: boolean;
  missingOutputs: string[];
  completedOutputs: string[];
};

const requiredOutputs: Array<[keyof SystemOutputCounts, string]> = [
  ["profileCuts", "Cutting list"],
  ["glassCuts", "Glass list"],
  ["beadingCuts", "Beading cuts"],
  ["hardwareBom", "Hardware BOM"]
];

export function getSystemOutputStatus(counts: SystemOutputCounts): SystemOutputStatus {
  const missingOutputs = requiredOutputs.filter(([key]) => Number(counts[key] ?? 0) <= 0).map(([, label]) => label);
  const completedOutputs = requiredOutputs.filter(([key]) => Number(counts[key] ?? 0) > 0).map(([, label]) => label);

  return {
    productionReady: missingOutputs.length === 0,
    optimizationReady: Number(counts.optimizationRuns ?? 0) > 0,
    missingOutputs,
    completedOutputs
  };
}
