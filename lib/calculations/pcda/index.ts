/**
 * PCDA Calculation Library
 * 
 * Pure, side-effect-free calculation functions for the PCDA technical-commercial
 * data model. All business logic lives here — never duplicated in React components.
 */

export { NOT_CAPTURED, isCaptured, type CalcResult } from "./sentinel";
export { roundWeight, roundQuantity, roundPercent, roundMoney } from "./rounding";
export { theoreticalWeight, quantityKg, weightVariance, type QtyMethod } from "./weight";
export { recoveryPercent, scrapPercent } from "./recovery";
export {
  costPerKg,
  costPerMeter,
  costPerPiece,
  contributionMargin,
  basicPrice,
  netRateAndLineValue,
  type BasicPriceParts,
  type PricingInput
} from "./cost";
