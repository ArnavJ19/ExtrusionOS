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

/** Statuses that block die usage in production */
const BLOCKED_DIE_STATUSES = new Set([
  "blocked", "retired", "scrapped", "dead", "inactive",
  "under_correction", "correction", "design", "ordered"
]);

/** Statuses that warn but don't block */
const WARNING_DIE_STATUSES = new Set([
  "under_trial", "trial", "nitriding", "under_maintenance"
]);

/**
 * Gate: Can this die be used for production?
 * Blocks on blocked/retired/correction/dead statuses unless Owner_Admin override.
 */
export function canUseDieForProduction(dieStatus: string | null, isOwnerAdmin = false): GateDecision {
  if (!dieStatus) return { allowed: false, reason: "Die status is unknown." };

  if (BLOCKED_DIE_STATUSES.has(dieStatus)) {
    if (isOwnerAdmin) return { allowed: true, reason: `Owner override: die status is ${dieStatus}.` };
    return { allowed: false, reason: `Die is ${dieStatus.replace(/_/g, " ")}. Cannot be used for production.`, requiresOverride: true };
  }

  if (WARNING_DIE_STATUSES.has(dieStatus)) {
    return { allowed: true, reason: `Warning: die is ${dieStatus.replace(/_/g, " ")}. Proceed with caution.` };
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
