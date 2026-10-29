type QuoteDemandLine = { total_weight_kg?: unknown; billing_weight_kg?: unknown };

export function summarizeQuotePhysicalDemand(lines: readonly QuoteDemandLine[]) {
  if (!lines.length) return { ok: false as const, physicalKg: null, billingKg: null, reason: "The quotation has no physical profile requirements." };
  let physicalKg = 0;
  let billingKg: number | null = 0;
  for (const line of lines) {
    const physical = line.total_weight_kg == null || line.total_weight_kg === "" ? NaN : Number(line.total_weight_kg);
    if (!Number.isFinite(physical) || physical <= 0) return { ok: false as const, physicalKg: null, billingKg: null, reason: "A quotation line is missing its physical profile weight. Review the quotation before planning manufacturing." };
    physicalKg += physical;
    const billing = line.billing_weight_kg == null || line.billing_weight_kg === "" ? NaN : Number(line.billing_weight_kg);
    billingKg = billingKg !== null && Number.isFinite(billing) && billing > 0 ? billingKg + billing : null;
  }
  if (!Number.isFinite(physicalKg) || physicalKg > 99_999_999_999.999) return { ok: false as const, physicalKg: null, billingKg: null, reason: "The physical requirement is outside the supported quantity range." };
  return { ok: true as const, physicalKg: Math.round(physicalKg * 1000) / 1000, billingKg: billingKg !== null && Number.isFinite(billingKg) ? Math.round(billingKg * 1000) / 1000 : null, reason: null };
}
