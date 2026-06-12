type QuoteReadyConfiguration = {
  status?: string | null;
  quote_id?: string | null;
  customer_id?: string | null;
  grand_total?: number | string | null;
};

type QuoteReadyCut = {
  profile_id?: string | null;
  total_length_m?: number | string | null;
  total_weight_kg?: number | string | null;
};

export type SystemQuoteReadiness = {
  ready: boolean;
  reason: string | null;
};

export function getSystemQuoteReadiness(configuration: QuoteReadyConfiguration | null | undefined, profileCuts: QuoteReadyCut[] = [], requireProfileCut = false): SystemQuoteReadiness {
  if (!configuration) return { ready: false, reason: "Configuration not found." };
  if (configuration.quote_id) return { ready: true, reason: null };
  if (configuration.status !== "calculated") return { ready: false, reason: "Resolve critical calculation warnings and recalculate before converting to quote." };
  if (!configuration.customer_id) return { ready: false, reason: "Link a customer before converting this configuration to a quote." };
  if (Number(configuration.grand_total ?? 0) <= 0) return { ready: false, reason: "Calculate this configuration before generating a quote." };
  if (requireProfileCut && !profileCuts.some((cut) => cut.profile_id && Number(cut.total_length_m ?? 0) > 0 && Number(cut.total_weight_kg ?? 0) > 0)) {
    return { ready: false, reason: "At least one calculated profile cut with a profile is required to create a quote item." };
  }

  return { ready: true, reason: null };
}

export function assertSystemQuoteReady(configuration: QuoteReadyConfiguration, profileCuts: QuoteReadyCut[] = [], requireProfileCut = false) {
  const readiness = getSystemQuoteReadiness(configuration, profileCuts, requireProfileCut);
  if (!readiness.ready) throw new Error(readiness.reason ?? "Configuration is not ready for quote conversion.");
}
