/**
 * PCDA Workflow Gates
 * 
 * Server-side gating rules evaluated against persisted records.
 * Gates return a decision object rather than throwing,
 * so callers can apply Owner_Admin overrides and audit them.
 */

export type GateDecision = {
  allowed: boolean;
  reason?: string;
  requiresOverride?: boolean;
};

import { isUsableProductionDieStatus } from "../production-dies.ts";

/**
 * Gate: Can this die be used for production?
 * Matches scheduling and SQL release/start; die status has no role override.
 */
export function canUseDieForProduction(dieStatus: string | null, isOwnerAdmin = false): GateDecision {
  if (!dieStatus) return { allowed: false, reason: "Die status is unknown." };

  if (!isUsableProductionDieStatus(dieStatus)) {
    return {allowed: false, requiresOverride: false, reason: `Die is ${dieStatus.replace(/_/g, " ")}. Only active or approved dies can be used for production.${isOwnerAdmin ? " Review and approve the die in Die Master before scheduling." : ""}`};
  }

  return { allowed: true };
}

/**
 * Gate: Can this profile be approved?
 * Blocks if no drawing is uploaded unless Owner_Admin override.
 */
export function canApproveProfile(hasDrawing: boolean, isOwnerAdmin = false): GateDecision {
  if (!hasDrawing) {
    if (isOwnerAdmin) return { allowed: true, reason: "Owner override: profile approved without drawing." };
    return { allowed: false, reason: "Profile cannot be approved without an uploaded drawing.", requiresOverride: true };
  }
  return { allowed: true };
}

/**
 * Gate: Can this quote be converted to an order?
 * Blocks if the section drawing is not approved unless Owner_Admin override.
 */
export function canConvertQuoteToOrder(drawingApprovalStatus: string | null, isOwnerAdmin = false): GateDecision {
  const normalizedStatus = drawingApprovalStatus?.toLowerCase();
  if (normalizedStatus !== "approved") {
    if (isOwnerAdmin) return { allowed: true, reason: "Owner override: quote converted with unapproved drawing." };
    return { allowed: false, reason: "Drawing must be approved before converting quote to order.", requiresOverride: true };
  }
  return { allowed: true };
}

/**
 * Gate: Should nitriding alert be triggered?
 * Returns true when usage since last nitriding exceeds the threshold.
 */
export function shouldTriggerNitridingAlert(
  tonsSinceLastNitriding: number | null,
  runsSinceLastNitriding: number | null,
  tonsThreshold = 15,
  runsThreshold = 100
): boolean {
  if (tonsSinceLastNitriding !== null && tonsSinceLastNitriding >= tonsThreshold) return true;
  if (runsSinceLastNitriding !== null && runsSinceLastNitriding >= runsThreshold) return true;
  return false;
}

/**
 * Gate: Is production route complete for this profile?
 * Checks that at least one routing step exists.
 */
export function isProductionRouteComplete(routingStepCount: number): GateDecision {
  if (routingStepCount <= 0) {
    return { allowed: false, reason: "Production route is incomplete for this profile.", requiresOverride: true };
  }
  return { allowed: true };
}

/**
 * Gate: Can dispatch proceed?
 * Blocks while quality approval is pending unless Owner_Admin override.
 */
export function canDispatchWithQualityStatus(qualityApprovalStatus: string | null, isOwnerAdmin = false): GateDecision {
  const normalizedStatus = qualityApprovalStatus?.toLowerCase();
  if (!normalizedStatus || normalizedStatus === "pending") {
    if (isOwnerAdmin) return { allowed: true, reason: "Owner override: dispatch allowed with pending quality approval." };
    return { allowed: false, reason: "Quality approval is pending. Dispatch cannot proceed.", requiresOverride: true };
  }
  return { allowed: true };
}
