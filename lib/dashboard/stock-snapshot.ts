export type StockSnapshot = {
  billetKg: number;
  billetBatchCount: number;
  billetByAlloy: { alloy: string; kg: number }[];
  finishedKg: number;
  finishedPieces: number;
  reservedKg: number;
  holdKg: number;
  finishedByFinish: { finish: string; kg: number }[];
  consumableItemCount: number;
  lowItemCount: number;
  outOfStockCount: number;
};

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function rows<T extends string>(value: unknown, key: T): ({ kg: number } & Record<T, string>)[] {
  if (!Array.isArray(value)) return [];
  return value.map((row) => ({ [key]: String((row as Record<string, unknown>)?.[key] ?? ""), kg: num((row as Record<string, unknown>)?.kg) }) as { kg: number } & Record<T, string>);
}

/** Parses the get_stock_snapshot() RPC payload; returns null when the payload is not an object. */
export function parseStockSnapshot(data: unknown): StockSnapshot | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  return {
    billetKg: num(d.billetKg),
    billetBatchCount: num(d.billetBatchCount),
    billetByAlloy: rows(d.billetByAlloy, "alloy"),
    finishedKg: num(d.finishedKg),
    finishedPieces: num(d.finishedPieces),
    reservedKg: num(d.reservedKg),
    holdKg: num(d.holdKg),
    finishedByFinish: rows(d.finishedByFinish, "finish"),
    consumableItemCount: num(d.consumableItemCount),
    lowItemCount: num(d.lowItemCount),
    outOfStockCount: num(d.outOfStockCount)
  };
}

/** Weight in kg shown as tonnes from 1,000 kg upward. */
export function formatStockWeight(kg: number): string {
  if (Math.abs(kg) >= 1000) return `${(kg / 1000).toLocaleString("en-IN", { maximumFractionDigits: 2 })} t`;
  return `${kg.toLocaleString("en-IN", { maximumFractionDigits: 0 })} kg`;
}
