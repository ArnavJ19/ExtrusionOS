export type AssistantCustomer = {
  id: string;
  customer_name: string;
  company_name?: string | null;
  customer_type?: string | null;
  phone?: string | null;
  whatsapp_number?: string | null;
  gst_number?: string | null;
};

export type AssistantProfile = {
  id: string;
  profile_code: string;
  profile_name: string;
  application_category?: string | null;
  section_weight_kg_per_m?: number | null;
  finish_options?: string[] | null;
};

export type SimilarQuote = {
  id: string;
  quote_number: string;
  status?: string | null;
  quote_date?: string | null;
  grand_total?: number | null;
  customer_name?: string | null;
};

export type AssistantSettings = {
  default_gst_percent?: number | null;
  default_margin_percent?: number | null;
  default_conversion_charge_per_kg?: number | null;
  default_packing_charge?: number | null;
  default_transport_charge?: number | null;
  minimum_margin_percent?: number | null;
  default_payment_terms?: string | null;
  default_delivery_terms?: string | null;
  allow_external_ai?: boolean | null;
  redact_sensitive_data?: boolean | null;
};

export type QuotationAssistantContext = {
  customers: AssistantCustomer[];
  profiles: AssistantProfile[];
  similarQuotes: SimilarQuote[];
  settings: AssistantSettings;
};

export type QuotationAssistantOutput = {
  parsed: {
    customerText: string | null;
    quantityKg: number | null;
    quantityPieces: number | null;
    finish: string | null;
    application: string | null;
    alloy: string | null;
    temper: string | null;
    deliveryText: string | null;
  };
  matchedCustomer: AssistantCustomer | null;
  suggestedProfiles: AssistantProfile[];
  suggestedItems: Array<{
    profile_id: string | null;
    profile_code: string | null;
    description: string;
    estimated_weight_kg: number | null;
    finishing_type: string;
    confidence: number;
  }>;
  missingInformation: string[];
  warnings: Array<{ severity: "info" | "warning" | "critical"; message: string }>;
  priceSanity: Array<{ severity: "info" | "warning"; message: string }>;
  similarQuotes: SimilarQuote[];
  quoteExplanation: string;
  customerSummary: string;
  ownerApprovalSummary: string;
  whatsappSummary: string;
  confidenceScore: number;
  redactionApplied: boolean;
  redactedInputText: string;
  externalAiBlocked: boolean;
  externalAi?: {
    provider: string;
    model: string;
    status: "completed" | "skipped" | "failed";
    content: string | null;
    error?: string;
  };
};

const finishingAliases: Array<[string, string]> = [
  ["powder coated", "powder_coating"],
  ["powder coating", "powder_coating"],
  ["black powder", "powder_coating"],
  ["anodized", "anodizing"],
  ["anodised", "anodizing"],
  ["anodizing", "anodizing"],
  ["mill finish", "mill_finish"],
  ["wood finish", "wood_finish"],
  ["wood grain", "wood_grain"],
  ["pvdf", "pvdf"]
];

const applicationAliases: Array<[string, string]> = [
  ["2 track", "sliding_window"],
  ["two track", "sliding_window"],
  ["sliding", "sliding_window"],
  ["casement", "casement_window"],
  ["curtain wall", "curtain_wall"],
  ["partition", "partition"],
  ["railing", "railing"],
  ["solar", "solar"],
  ["heat sink", "heat_sink"],
  ["industrial", "industrial"],
  ["door", "door"],
  ["window", "sliding_window"]
];

const sensitivePatterns: Array<[RegExp, string]> = [
  [/\bmargin\s*[:=]?\s*\d+(\.\d+)?\s*%?/gi, "margin: [REDACTED]"],
  [/\bcost\s*price\s*[:=]?\s*\d+(\.\d+)?/gi, "cost price: [REDACTED]"],
  [/\bsupplier\s*rate\s*[:=]?\s*\d+(\.\d+)?/gi, "supplier rate: [REDACTED]"],
  [/\bbillet\s*rate\s*[:=]?\s*\d+(\.\d+)?/gi, "billet rate: [REDACTED]"],
  [/\bconversion\s*charge\s*[:=]?\s*\d+(\.\d+)?/gi, "conversion charge: [REDACTED]"],
  [/\b[A-Z]{4}0[A-Z0-9]{6}\b/g, "[IFSC_REDACTED]"],
  [/\b\d{9,18}\b/g, "[NUMBER_REDACTED]"]
];

export function redactSensitiveText(input: string) {
  return sensitivePatterns.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), input);
}

export function parseQuotationRequest(input: string) {
  const normalized = normalize(input);
  const quantityKg = extractNumber(normalized, /(?:need|require|for|approx|around)?\s*(\d+(?:\.\d+)?)\s*(?:kg|kgs|kilogram|kilograms)\b/i);
  const quantityPieces = extractNumber(normalized, /(\d+(?:\.\d+)?)\s*(?:pcs|pieces|nos|numbers)\b/i);
  const finish = finishingAliases.find(([needle]) => normalized.includes(needle))?.[1] ?? null;
  const application = applicationAliases.find(([needle]) => normalized.includes(needle))?.[1] ?? null;
  const alloy = normalized.match(/\b(6063|6061|6082|6005|1050|1060)\b/i)?.[1]?.toUpperCase() ?? null;
  const temper = normalized.match(/\b(T4|T5|T6|T651|O)\b/i)?.[1]?.toUpperCase() ?? null;
  const customerText = extractCustomerText(input);
  const deliveryText = input.match(/delivery\s+(?:by|within|next|in|on)?\s*([^.,\n]+)/i)?.[0] ?? (normalized.includes("next week") ? "delivery next week" : null);

  return { customerText, quantityKg, quantityPieces, finish, application, alloy, temper, deliveryText };
}

export function buildQuotationAssistantOutput(input: string, context: QuotationAssistantContext): QuotationAssistantOutput {
  const redactionApplied = context.settings.redact_sensitive_data !== false;
  const redactedInputText = redactionApplied ? redactSensitiveText(input) : input;
  const parsed = parseQuotationRequest(redactedInputText);
  const matchedCustomer = matchCustomer(parsed.customerText ?? redactedInputText, context.customers);
  const suggestedProfiles = matchProfiles(redactedInputText, parsed.application, context.profiles).slice(0, 5);
  const missingInformation = buildMissingInformation(parsed, matchedCustomer, suggestedProfiles);
  const warnings = buildWarnings(parsed, matchedCustomer, context.settings);
  const priceSanity = buildPriceSanity(context.settings);
  const suggestedItems = suggestedProfiles.length
    ? suggestedProfiles.slice(0, 3).map((profile, index) => ({
        profile_id: profile.id,
        profile_code: profile.profile_code,
        description: `${profile.profile_code} ${profile.profile_name}`,
        estimated_weight_kg: parsed.quantityKg,
        finishing_type: parsed.finish ?? firstFinish(profile.finish_options) ?? "mill_finish",
        confidence: Math.max(45, 85 - index * 10)
      }))
    : [{ profile_id: null, profile_code: null, description: parsed.application ? `Profile required for ${parsed.application.replace(/_/g, " ")}` : "Profile to be confirmed", estimated_weight_kg: parsed.quantityKg, finishing_type: parsed.finish ?? "mill_finish", confidence: 25 }];
  const confidenceScore = calculateConfidence(parsed, matchedCustomer, suggestedProfiles, missingInformation);
  const quoteExplanation = buildQuoteExplanation(parsed, matchedCustomer, suggestedItems, context.settings);
  const customerSummary = buildCustomerSummary(parsed, matchedCustomer, suggestedItems);
  const ownerApprovalSummary = buildOwnerSummary(parsed, matchedCustomer, warnings, priceSanity, confidenceScore);
  const whatsappSummary = buildWhatsappSummary(parsed, matchedCustomer, suggestedItems);

  return {
    parsed,
    matchedCustomer,
    suggestedProfiles,
    suggestedItems,
    missingInformation,
    warnings,
    priceSanity,
    similarQuotes: context.similarQuotes.slice(0, 5),
    quoteExplanation,
    customerSummary,
    ownerApprovalSummary,
    whatsappSummary,
    confidenceScore,
    redactionApplied,
    redactedInputText,
    externalAiBlocked: context.settings.allow_external_ai !== true
  };
}

function normalize(input: string) {
  return input.toLowerCase().replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
}

function extractNumber(input: string, pattern: RegExp) {
  const match = input.match(pattern);
  return match ? Number(match[1]) : null;
}

function extractCustomerText(input: string) {
  const match = input.match(/(?:for|from|customer|client)\s+([A-Za-z0-9 .&-]{3,80})/i);
  if (!match) return null;
  return match[1].replace(/\b(same as|delivery|need|require|with|for)\b.*$/i, "").trim() || null;
}

function matchCustomer(text: string, customers: AssistantCustomer[]) {
  const needle = normalize(text);
  if (!needle) return null;
  return customers
    .map((customer) => ({ customer, score: scoreText(needle, `${customer.customer_name} ${customer.company_name ?? ""} ${customer.phone ?? ""}`) }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.customer ?? null;
}

function matchProfiles(input: string, application: string | null, profiles: AssistantProfile[]) {
  const needle = normalize(input);
  return profiles
    .map((profile) => {
      const applicationScore = application && profile.application_category === application ? 6 : 0;
      const textScore = scoreText(needle, `${profile.profile_code} ${profile.profile_name} ${profile.application_category ?? ""}`);
      return { profile, score: applicationScore + textScore };
    })
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((match) => match.profile);
}

function scoreText(needle: string, target: string) {
  const normalizedTarget = normalize(target);
  const tokens = needle.split(" ").filter((token) => token.length > 2);
  let score = normalizedTarget.includes(needle) ? 8 : 0;
  for (const token of tokens) {
    if (normalizedTarget.includes(token)) score += 1;
  }
  return score;
}

function buildMissingInformation(parsed: ReturnType<typeof parseQuotationRequest>, customer: AssistantCustomer | null, profiles: AssistantProfile[]) {
  const missing: string[] = [];
  if (!customer) missing.push("Confirm customer name or create the customer record.");
  if (!profiles.length) missing.push("Confirm exact profile code or system series.");
  if (!parsed.quantityKg && !parsed.quantityPieces) missing.push("Confirm quantity in kg or pieces.");
  if (!parsed.finish) missing.push("Confirm finish type and shade.");
  if (!parsed.alloy) missing.push("Confirm alloy, typically 6063/6061/6082.");
  if (!parsed.temper) missing.push("Confirm temper, typically T5 or T6.");
  if (!parsed.deliveryText) missing.push("Confirm required delivery date or timeline.");
  return missing;
}

function buildWarnings(parsed: ReturnType<typeof parseQuotationRequest>, customer: AssistantCustomer | null, settings: AssistantSettings) {
  const warnings: QuotationAssistantOutput["warnings"] = [];
  if (!customer?.gst_number) warnings.push({ severity: "info", message: "Customer GST is missing or not matched; verify before sending tax quotation." });
  if (!parsed.quantityKg && parsed.quantityPieces) warnings.push({ severity: "warning", message: "Pieces were found but kg was not. Section weight and length are required for accurate costing." });
  if (!settings.default_conversion_charge_per_kg || settings.default_conversion_charge_per_kg <= 0) warnings.push({ severity: "critical", message: "Default conversion charge is not configured; costing may be incomplete." });
  if (!settings.default_margin_percent || settings.default_margin_percent < (settings.minimum_margin_percent ?? 0)) warnings.push({ severity: "warning", message: "Default margin is below or close to minimum margin policy." });
  return warnings;
}

function buildPriceSanity(settings: AssistantSettings) {
  const sanity: QuotationAssistantOutput["priceSanity"] = [];
  if ((settings.default_gst_percent ?? 0) <= 0) sanity.push({ severity: "warning", message: "GST default is zero. Confirm whether this is an export/exempt quotation." });
  if ((settings.default_packing_charge ?? 0) === 0) sanity.push({ severity: "info", message: "Packing charge default is zero; verify if packing is included in conversion." });
  if ((settings.default_transport_charge ?? 0) === 0) sanity.push({ severity: "info", message: "Transport charge default is zero; quote may need ex-works or freight note." });
  return sanity;
}

function calculateConfidence(parsed: ReturnType<typeof parseQuotationRequest>, customer: AssistantCustomer | null, profiles: AssistantProfile[], missing: string[]) {
  let score = 35;
  if (customer) score += 20;
  if (profiles.length) score += 20;
  if (parsed.quantityKg || parsed.quantityPieces) score += 10;
  if (parsed.finish) score += 5;
  if (parsed.deliveryText) score += 5;
  score -= Math.min(20, missing.length * 3);
  return Math.max(0, Math.min(100, score));
}

function firstFinish(options: string[] | null | undefined) {
  return options?.find(Boolean) ?? null;
}

function buildQuoteExplanation(parsed: ReturnType<typeof parseQuotationRequest>, customer: AssistantCustomer | null, items: QuotationAssistantOutput["suggestedItems"], settings: AssistantSettings) {
  return `Draft based on ${parsed.quantityKg ? `${parsed.quantityKg} kg` : parsed.quantityPieces ? `${parsed.quantityPieces} pieces` : "unconfirmed quantity"} for ${customer?.company_name || customer?.customer_name || "unconfirmed customer"}. Suggested ${items.length} line item(s), using ${parsed.finish?.replace(/_/g, " ") || "finish to be confirmed"}, GST ${settings.default_gst_percent ?? 18}%, and company default conversion/margin settings. Verify missing fields before creating the formal quote.`;
}

function buildCustomerSummary(parsed: ReturnType<typeof parseQuotationRequest>, customer: AssistantCustomer | null, items: QuotationAssistantOutput["suggestedItems"]) {
  return `Quotation draft for ${customer?.company_name || customer?.customer_name || "your requirement"}: ${items.map((item) => item.description).join(", ")} ${parsed.quantityKg ? `for approx. ${parsed.quantityKg} kg` : ""}. Finish: ${parsed.finish?.replace(/_/g, " ") || "to be confirmed"}. Delivery: ${parsed.deliveryText || "to be confirmed"}.`;
}

function buildOwnerSummary(parsed: ReturnType<typeof parseQuotationRequest>, customer: AssistantCustomer | null, warnings: QuotationAssistantOutput["warnings"], sanity: QuotationAssistantOutput["priceSanity"], confidence: number) {
  const critical = warnings.filter((warning) => warning.severity === "critical").length;
  return `AI quotation assist confidence ${confidence}%. Customer match: ${customer?.company_name || customer?.customer_name || "not confirmed"}. Quantity: ${parsed.quantityKg ?? parsed.quantityPieces ?? "missing"}. Critical warnings: ${critical}. Price sanity checks: ${sanity.length}. Owner approval should review missing profile/quantity/finish fields before sending.`;
}

function buildWhatsappSummary(parsed: ReturnType<typeof parseQuotationRequest>, customer: AssistantCustomer | null, items: QuotationAssistantOutput["suggestedItems"]) {
  return `Hello ${customer?.customer_name || "Sir/Madam"}, noted your aluminium profile requirement${parsed.quantityKg ? ` of approx. ${parsed.quantityKg} kg` : ""}. We are checking ${items[0]?.description || "the suitable profile"} with ${parsed.finish?.replace(/_/g, " ") || "the required finish"}. Please confirm alloy/temper, exact profile/drawing, and delivery timeline so we can share the final quotation.`;
}
