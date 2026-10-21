import { readDispatchManifest, type DispatchBundleDraft, type DispatchPreparationSource } from "./preparation";

export type DispatchOrderBalance = {
  orderId: string; orderLabel: string;
  ordered: { pieces: number; metres: number }; shipped: { pieces: number; metres: number };
};

export function projectOrderRemainder(balance: DispatchOrderBalance, load: { pieces: number; metres: number }) {
  return {
    pieces: balance.ordered.pieces - balance.shipped.pieces - load.pieces,
    metres: (Math.round(balance.ordered.metres * 1000) - Math.round(balance.shipped.metres * 1000) - Math.round(load.metres * 1000)) / 1000,
  };
}

export function buildDispatchReview(sources: DispatchPreparationSource[], companyId: string, orderId: string, rows: DispatchBundleDraft[]) {
  const bundles = readDispatchManifest(sources, companyId, orderId, rows);
  const totals = bundles.reduce((sum, row) => ({ pieces: sum.pieces + row.number_of_pieces, metres: sum.metres + row.net_length_m, gross: sum.gross + row.gross_weight_kg, tare: sum.tare + row.tare_weight_kg, net: sum.net + row.gross_weight_kg - row.tare_weight_kg }), { pieces: 0, metres: 0, gross: 0, tare: 0, net: 0 });
  const balances = sources.filter((source) => bundles.some((row) => row.source_line_id === source.id)).map((source) => {
    const used = bundles.filter((row) => row.source_line_id === source.id).reduce((sum, row) => ({ kg: sum.kg + row.gross_weight_kg - row.tare_weight_kg, pieces: sum.pieces + row.number_of_pieces, metres: sum.metres + row.net_length_m }), { kg: 0, pieces: 0, metres: 0 });
    return { id: source.id, label: `${source.profileLabel} / ${source.sourceLabel}`, kg: source.availableWeightKg - used.kg, pieces: source.availablePieces - used.pieces, metres: source.availableLengthM - used.metres };
  });
  return { bundles, totals, balances };
}
