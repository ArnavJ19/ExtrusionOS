export const usableProductionDieStatuses = ["active", "approved"] as const;

export function isUsableProductionDieStatus(status: unknown): boolean {
  return typeof status === "string" && (usableProductionDieStatuses as readonly string[]).includes(status);
}

export function isUsableProductionDieForProfile(
  die: {profile_id?: unknown; die_status?: unknown} | null | undefined, profileId: unknown
): boolean {
  return typeof profileId === "string" && profileId.length > 0 && die?.profile_id === profileId && isUsableProductionDieStatus(die.die_status);
}
