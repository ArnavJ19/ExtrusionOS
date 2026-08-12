import type { DieAmortizationType, FinishingChargeType } from "@/types/app";

export type QuoteItemInput = {
  quantity_pieces: number;
  length_per_piece_m: number;
  section_weight_kg_per_m: number;
  scrap_allowance_percent?: number;
  expected_recovery_percent?: number;
  minimum_billing_weight_kg?: number;
  billet_rate_per_kg: number;
  conversion_charge_per_kg: number;
  finishing_charge_type: FinishingChargeType;
  finishing_charge: number;
  die_charge: number;
  die_amortization_type?: DieAmortizationType;
  die_amortization_quantity_kg?: number;
  packing_charge: number;
  transport_charge: number;
  other_charges: number;
  margin_percent: number;
  sales_price_override?: number | null;
  minimum_margin_percent?: number;
  // Profile surface area (sq.m per running meter). Used only to price per_sqft finishing.
  surface_area_per_meter_sqm?: number | null;
};

export type QuoteItemCalculated = QuoteItemInput & {
  total_meters: number;
  total_weight_kg: number;
  effective_weight_kg: number;
  billing_weight_kg: number;
  billet_input_weight_kg: number;
  finishing_surface_area_sqft: number;
  raw_material_cost: number;
  conversion_cost: number;
  finishing_cost: number;
  die_amortization_type: DieAmortizationType;
  die_amortization_quantity_kg: number;
  die_amortization_amount: number;
  line_subtotal: number;
  margin_amount: number;
  line_total_before_gst: number;
  sales_price_override: number | null;
  minimum_margin_percent: number;
  approval_required: boolean;
  estimated_profit_amount: number;
  estimated_profit_percent: number;
  price_per_kg: number;
  price_per_meter: number;
};

export type QuoteSummary = {
  subtotal: number;
  total_margin_amount: number;
  total_before_gst: number;
  gst_percent: number;
  gst_amount: number;
  grand_total: number;
  total_weight_kg: number;
  total_billing_weight_kg: number;
  total_meters: number;
  estimated_profit_amount: number;
  estimated_profit_percent: number;
  low_margin_approval_required: boolean;
  average_price_per_kg: number;
  average_price_per_meter: number;
};

export type QuoteWarningSeverity = "info" | "warning" | "critical";

export type QuoteWarning = {
  code: string;
  severity: QuoteWarningSeverity;
  message: string;
};

const n = (value: number | null | undefined) => Number.isFinite(Number(value)) ? Number(value) : 0;
const nonNegative = (value: number | null | undefined) => Math.max(0, n(value));
const money = (value: number) => Math.round(nonNegative(value) * 100) / 100;
const signedMoney = (value: number) => Math.round(n(value) * 100) / 100;
const qty = (value: number) => Math.round(nonNegative(value) * 1000) / 1000;

export function calculateFinishingCost(chargeType: FinishingChargeType, charge: number, billingWeightKg: number, totalMeters: number, surfaceAreaSqft?: number) {
  if (chargeType === "per_kg") return money(billingWeightKg * nonNegative(charge));
  if (chargeType === "per_meter") return money(totalMeters * nonNegative(charge));
  if (chargeType === "fixed") return money(charge);
  if (chargeType === "per_sqft") {
    // Price strictly from the real surface area (derived from the profile's sq.m/m).
    // No fabricated perimeter guess: without a captured surface area we cannot price
    // per sq.ft, so the line contributes zero finishing cost and a warning is raised
    // upstream (see getQuoteItemWarnings -> "surface_area_missing").
    const area = nonNegative(surfaceAreaSqft);
    return area > 0 ? money(area * nonNegative(charge)) : 0;
  }
  return 0;
}

export function calculateDieAmortization(input: { dieCharge: number; billingWeightKg: number; type?: DieAmortizationType; quantityKg?: number }) {
  const type = input.type ?? "full_die_charge";
  const dieCharge = nonNegative(input.dieCharge);
  if (type === "waived" || type === "customer_paid") return 0;
  if (type === "per_kg") {
    const spreadQuantity = nonNegative(input.quantityKg);
    return spreadQuantity > 0 ? money((dieCharge / spreadQuantity) * nonNegative(input.billingWeightKg)) : 0;
  }
  return money(dieCharge);
}

export function calculateQuoteItem(input: QuoteItemInput): QuoteItemCalculated {
  const quantity_pieces = nonNegative(input.quantity_pieces);
  const length_per_piece_m = nonNegative(input.length_per_piece_m);
  const section_weight_kg_per_m = nonNegative(input.section_weight_kg_per_m);
  const scrap_allowance_percent = nonNegative(input.scrap_allowance_percent);
  const expected_recovery_percent = input.expected_recovery_percent === undefined ? 100 : nonNegative(input.expected_recovery_percent);
  const minimum_billing_weight_kg = nonNegative(input.minimum_billing_weight_kg);
  const die_amortization_type = input.die_amortization_type ?? "full_die_charge";
  const die_amortization_quantity_kg = nonNegative(input.die_amortization_quantity_kg);
  const sales_price_override = input.sales_price_override === null || input.sales_price_override === undefined || nonNegative(input.sales_price_override) === 0 ? null : money(input.sales_price_override);
  const minimum_margin_percent = nonNegative(input.minimum_margin_percent);
  const total_meters = qty(quantity_pieces * length_per_piece_m);
  const total_weight_kg = qty(total_meters * section_weight_kg_per_m);
  const effective_weight_kg = qty(total_weight_kg * (1 + scrap_allowance_percent / 100));
  const billing_weight_kg = qty(Math.max(effective_weight_kg, minimum_billing_weight_kg));
  // Yield/recovery: at <100% expected recovery more billet is melted than is shipped,
  // so raw material must be costed on the grossed-up billet INPUT, not the billed weight.
  // Recovery of 0 or >=100 (or missing) means no adjustment (factor = 1).
  const recovery_factor = expected_recovery_percent > 0 && expected_recovery_percent < 100 ? expected_recovery_percent / 100 : 1;
  const billet_input_weight_kg = qty(billing_weight_kg / recovery_factor);
  const finishing_surface_area_sqft = qty(nonNegative(input.surface_area_per_meter_sqm) * total_meters * 10.764);
  const raw_material_cost = money(billet_input_weight_kg * nonNegative(input.billet_rate_per_kg));
  const conversion_cost = money(billing_weight_kg * nonNegative(input.conversion_charge_per_kg));
  const finishing_cost = calculateFinishingCost(input.finishing_charge_type, input.finishing_charge, billing_weight_kg, total_meters, finishing_surface_area_sqft);
  const die_amortization_amount = calculateDieAmortization({ dieCharge: input.die_charge, billingWeightKg: billing_weight_kg, type: die_amortization_type, quantityKg: die_amortization_quantity_kg });
  const line_subtotal = money(raw_material_cost + conversion_cost + finishing_cost + die_amortization_amount + nonNegative(input.packing_charge) + nonNegative(input.transport_charge) + nonNegative(input.other_charges));
  const margin_amount = money(line_subtotal * nonNegative(input.margin_percent) / 100);
  const calculatedSellingBeforeGst = money(line_subtotal + margin_amount);
  const line_total_before_gst = sales_price_override ?? calculatedSellingBeforeGst;
  const estimated_profit_amount = signedMoney(line_total_before_gst - line_subtotal);
  const estimated_profit_percent = line_total_before_gst > 0 ? Math.round((estimated_profit_amount / line_total_before_gst) * 10000) / 100 : 0;
  // A line that has metal (billing weight) but no billet rate reports raw material cost
  // of zero and therefore a misleadingly large profit. This is legitimate only for
  // conversion/job-work where the customer supplies billet, so require sign-off rather
  // than hard-blocking: flag it for approval so it cannot be sent without an approver.
  const missing_billet_cost = billing_weight_kg > 0 && nonNegative(input.billet_rate_per_kg) <= 0;
  const approval_required = estimated_profit_percent < minimum_margin_percent || estimated_profit_amount < 0 || missing_billet_cost;
  return {
    ...input,
    quantity_pieces,
    length_per_piece_m,
    section_weight_kg_per_m,
    scrap_allowance_percent,
    expected_recovery_percent,
    minimum_billing_weight_kg,
    total_meters,
    total_weight_kg,
    effective_weight_kg,
    billing_weight_kg,
    billet_input_weight_kg,
    finishing_surface_area_sqft,
    raw_material_cost,
    conversion_cost,
    finishing_cost,
    die_amortization_type,
    die_amortization_quantity_kg,
    die_amortization_amount,
    line_subtotal,
    margin_amount,
    line_total_before_gst,
    sales_price_override,
    minimum_margin_percent,
    approval_required,
    estimated_profit_amount,
    estimated_profit_percent,
    price_per_kg: billing_weight_kg > 0 ? money(line_total_before_gst / billing_weight_kg) : 0,
    price_per_meter: total_meters > 0 ? money(line_total_before_gst / total_meters) : 0
  };
}

export function calculateQuoteSummary(items: QuoteItemCalculated[], gstPercent: number): QuoteSummary {
  const subtotal = money(items.reduce((sum, item) => sum + item.line_total_before_gst, 0));
  const total_margin_amount = signedMoney(items.reduce((sum, item) => sum + item.estimated_profit_amount, 0));
  const total_weight_kg = qty(items.reduce((sum, item) => sum + item.total_weight_kg, 0));
  const total_billing_weight_kg = qty(items.reduce((sum, item) => sum + item.billing_weight_kg, 0));
  const total_meters = qty(items.reduce((sum, item) => sum + item.total_meters, 0));
  const gst_amount = money(subtotal * n(gstPercent) / 100);
  const grand_total = money(subtotal + gst_amount);
  const estimated_profit_amount = total_margin_amount;
  const estimated_profit_percent = subtotal > 0 ? Math.round((estimated_profit_amount / subtotal) * 10000) / 100 : 0;
  return {
    subtotal,
    total_margin_amount,
    total_before_gst: subtotal,
    gst_percent: nonNegative(gstPercent),
    gst_amount,
    grand_total,
    total_weight_kg,
    total_billing_weight_kg,
    total_meters,
    estimated_profit_amount,
    estimated_profit_percent,
    low_margin_approval_required: items.some((item) => item.approval_required),
    average_price_per_kg: total_billing_weight_kg > 0 ? money(subtotal / total_billing_weight_kg) : 0,
    average_price_per_meter: total_meters > 0 ? money(subtotal / total_meters) : 0
  };
}

export function getQuoteItemWarnings(input: QuoteItemCalculated, options: { dieStatus?: string | null; customerGstNumber?: string | null; defaultConversionChargePerKg?: number | null; quoteValidUntil?: string | null } = {}): QuoteWarning[] {
  const warnings: QuoteWarning[] = [];
  const minimumBillingWeightKg = input.minimum_billing_weight_kg ?? 0;
  if (input.section_weight_kg_per_m <= 0) warnings.push({ code: "missing_section_weight", severity: "critical", message: "Missing section weight kg/m. Quote weight and pricing are unreliable." });
  if (input.billet_rate_per_kg <= 0) warnings.push({ code: "missing_billet_rate", severity: "critical", message: "Billet rate is missing. Raw material cost is zero." });
  if (input.estimated_profit_amount < 0) warnings.push({ code: "negative_margin", severity: "critical", message: "Selling price is below estimated base cost." });
  if (input.approval_required && input.estimated_profit_amount >= 0) warnings.push({ code: "low_margin", severity: "warning", message: `Estimated profit ${input.estimated_profit_percent.toFixed(2)}% is below minimum ${input.minimum_margin_percent}%.` });
  if (options.dieStatus && ["inactive", "dead"].includes(options.dieStatus)) warnings.push({ code: "inactive_die", severity: "warning", message: `Selected die is ${options.dieStatus.replace(/_/g, " ")}. Confirm before sending.` });
  if (minimumBillingWeightKg > 0 && input.effective_weight_kg < minimumBillingWeightKg) warnings.push({ code: "minimum_billing_weight", severity: "info", message: "Minimum billing weight is higher than calculated effective weight." });
  if (!options.customerGstNumber) warnings.push({ code: "missing_customer_gst", severity: "info", message: "Customer GST number is missing. Confirm whether GST details are required on the PDF." });
  if (options.defaultConversionChargePerKg && input.conversion_charge_per_kg < options.defaultConversionChargePerKg * 0.75) warnings.push({ code: "low_conversion_charge", severity: "warning", message: "Conversion charge is much lower than the company default." });
  if (input.sales_price_override !== null) warnings.push({ code: "manual_override", severity: "info", message: "Sales price is manually overridden. Profit is calculated from override." });
  if (input.finishing_charge_type === "per_sqft" && input.finishing_surface_area_sqft <= 0) warnings.push({ code: "surface_area_missing", severity: "warning", message: "Per sqft finishing needs the profile surface area (sq.m per meter). This line is costed at zero finishing until surface area is captured on the profile." });
  const recoveryPercent = input.expected_recovery_percent ?? 100;
  if (recoveryPercent > 0 && recoveryPercent < 100) warnings.push({ code: "recovery_applied", severity: "info", message: `Raw material is grossed up for ${recoveryPercent}% expected recovery (billet input ${input.billet_input_weight_kg.toFixed(3)} kg vs ${input.billing_weight_kg.toFixed(3)} kg billed).` });
  if (options.quoteValidUntil && new Date(options.quoteValidUntil) < new Date(new Date().toISOString().slice(0, 10))) warnings.push({ code: "expired_quote", severity: "warning", message: "Quote validity date has expired." });
  return warnings;
}
