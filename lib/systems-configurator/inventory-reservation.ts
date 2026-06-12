export type ProfileReservationRequirement = {
  profileId: string;
  profileCode: string;
  profileName: string;
  requiredWeightKg: number;
  requiredLengthM: number;
};

export type ProfileReservationStatus = ProfileReservationRequirement & {
  totalStockWeightKg: number;
  availableWeightKg: number;
  reservedWeightKg: number;
  shortageKg: number;
  ready: boolean;
};

export function groupProfileReservationRequirements(profileCuts: Record<string, any>[]): ProfileReservationRequirement[] {
  const map = new Map<string, ProfileReservationRequirement>();
  for (const cut of profileCuts) {
    if (!cut.profile_id) continue;
    const current = map.get(cut.profile_id) ?? { profileId: cut.profile_id, profileCode: cut.profile_code ?? "Profile", profileName: cut.profile_name ?? "", requiredWeightKg: 0, requiredLengthM: 0 };
    current.requiredWeightKg += Number(cut.total_weight_kg ?? 0);
    current.requiredLengthM += Number(cut.total_length_m ?? 0);
    map.set(cut.profile_id, current);
  }
  return Array.from(map.values()).map((item) => ({ ...item, requiredWeightKg: round3(item.requiredWeightKg), requiredLengthM: round3(item.requiredLengthM) }));
}

export function buildProfileReservationStatus(requirements: ProfileReservationRequirement[], stockBatches: Record<string, any>[], reservations: Record<string, any>[] = []): ProfileReservationStatus[] {
  return requirements.map((requirement) => {
    const batches = stockBatches.filter((batch) => batch.profile_id === requirement.profileId);
    const activeReservations = reservations.filter((reservation) => reservation.profile_id === requirement.profileId && reservation.status === "active");
    const totalStockWeightKg = round3(batches.filter((batch) => !["dispatched", "rejected", "scrap"].includes(batch.status)).reduce((sum, batch) => sum + Number(batch.total_weight_kg ?? 0), 0));
    const reservedWeightKg = round3(activeReservations.reduce((sum, reservation) => sum + Number(reservation.reserved_weight_kg ?? 0), 0));
    const availableWeightKg = round3(Math.max(totalStockWeightKg - reservedWeightKg, 0));
    const shortageKg = round3(Math.max(requirement.requiredWeightKg - availableWeightKg, 0));
    return { ...requirement, totalStockWeightKg, availableWeightKg, reservedWeightKg, shortageKg, ready: shortageKg === 0 };
  });
}

export function getBatchAvailableWeightKg(batch: Record<string, any>, reservations: Record<string, any>[]) {
  const reserved = reservations
    .filter((reservation) => reservation.profile_stock_batch_id === batch.id && reservation.status === "active")
    .reduce((sum, reservation) => sum + Number(reservation.reserved_weight_kg ?? 0), 0);
  return round3(Math.max(Number(batch.total_weight_kg ?? 0) - reserved, 0));
}

function round3(value: number) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}
