export type AlloyElementRange = {
  min?: number;
  max?: number;
};

export type AlloyComposition = Record<string, AlloyElementRange>;

export const alloyCompositionSources = {
  wikipedia6063: "https://en.wikipedia.org/wiki/6063_aluminium_alloy",
  wikipedia6061: "https://en.wikipedia.org/wiki/6061_aluminium_alloy",
  wikipedia6082: "https://en.wikipedia.org/wiki/6082_aluminium_alloy",
  wikipedia6005: "https://en.wikipedia.org/wiki/6005_aluminium_alloy",
  wikipedia1050: "https://en.wikipedia.org/wiki/1050_aluminium_alloy",
  wikipedia1060: "https://en.wikipedia.org/wiki/1060_aluminium_alloy"
} as const;

export const standardAlloyCompositions: Record<string, { source: string; composition: AlloyComposition }> = {
  "6063": {
    source: alloyCompositionSources.wikipedia6063,
    composition: {
      Al: { min: 97.5, max: 99.35 },
      Mg: { min: 0.45, max: 0.9 },
      Si: { min: 0.2, max: 0.6 },
      Fe: { min: 0, max: 0.35 },
      Cr: { min: 0, max: 0.1 },
      Cu: { min: 0, max: 0.1 },
      Mn: { min: 0, max: 0.1 },
      Ti: { min: 0, max: 0.1 },
      Zn: { min: 0, max: 0.1 },
      OthersTotal: { min: 0, max: 0.15 }
    }
  },
  "6061": {
    source: alloyCompositionSources.wikipedia6061,
    composition: {
      Al: { min: 95.85, max: 98.56 },
      Mg: { min: 0.8, max: 1.2 },
      Si: { min: 0.4, max: 0.8 },
      Fe: { min: 0, max: 0.7 },
      Cu: { min: 0.15, max: 0.4 },
      Cr: { min: 0.04, max: 0.35 },
      Zn: { min: 0, max: 0.25 },
      Ti: { min: 0, max: 0.15 },
      Mn: { min: 0, max: 0.15 },
      OthersTotal: { min: 0, max: 0.15 }
    }
  },
  "6082": {
    source: alloyCompositionSources.wikipedia6082,
    composition: {
      Al: { min: 95.2, max: 98.3 },
      Cr: { min: 0, max: 0.25 },
      Cu: { min: 0, max: 0.1 },
      Fe: { min: 0, max: 0.5 },
      Mg: { min: 0.6, max: 1.2 },
      Mn: { min: 0.4, max: 1.0 },
      Si: { min: 0.7, max: 1.3 },
      Ti: { min: 0, max: 0.1 },
      Zn: { min: 0, max: 0.2 },
      OthersTotal: { min: 0, max: 0.15 }
    }
  },
  "6005": {
    source: alloyCompositionSources.wikipedia6005,
    composition: {
      Al: { min: 97.5, max: 99.0 },
      Cr: { min: 0, max: 0.1 },
      Cu: { min: 0, max: 0.1 },
      Fe: { min: 0, max: 0.35 },
      Mg: { min: 0.4, max: 0.6 },
      Mn: { min: 0, max: 0.1 },
      Si: { min: 0.6, max: 0.9 },
      Ti: { min: 0, max: 0.1 },
      Zn: { min: 0, max: 0.1 },
      OthersTotal: { min: 0, max: 0.15 }
    }
  },
  "1050": {
    source: alloyCompositionSources.wikipedia1050,
    composition: {
      Al: { min: 99.5 },
      Cu: { min: 0, max: 0.05 },
      Fe: { min: 0, max: 0.4 },
      Mg: { min: 0, max: 0.05 },
      Mn: { min: 0, max: 0.05 },
      Si: { min: 0, max: 0.25 },
      Ti: { min: 0, max: 0.03 },
      V: { min: 0, max: 0.05 },
      Zn: { min: 0, max: 0.05 }
    }
  },
  "1060": {
    source: alloyCompositionSources.wikipedia1060,
    composition: {
      Al: { min: 99.6 },
      Cu: { min: 0, max: 0.05 },
      Fe: { min: 0, max: 0.35 },
      Mg: { min: 0, max: 0.03 },
      Mn: { min: 0, max: 0.03 },
      Si: { min: 0, max: 0.25 },
      Ti: { min: 0, max: 0.03 },
      V: { min: 0, max: 0.05 },
      Zn: { min: 0, max: 0.05 }
    }
  }
};

export function getStandardAlloyComposition(alloy: string) {
  return standardAlloyCompositions[alloy] ?? null;
}

export function compositionToEditableRows(composition: AlloyComposition) {
  return Object.entries(composition).map(([element, range]) => ({ element, min: range.min ?? "", max: range.max ?? "" }));
}

export function normalizeCompositionRows(rows: { element: string; min: string | number; max: string | number }[]) {
  return rows.reduce<AlloyComposition>((composition, row) => {
    const element = row.element.trim();
    if (!element) return composition;
    const min = row.min === "" ? undefined : Number(row.min);
    const max = row.max === "" ? undefined : Number(row.max);
    composition[element] = { ...(Number.isFinite(min) ? { min } : {}), ...(Number.isFinite(max) ? { max } : {}) };
    return composition;
  }, {});
}

export function compositionsMatch(a: AlloyComposition, b: AlloyComposition) {
  return JSON.stringify(a) === JSON.stringify(b);
}
