type Inspection = { production_job_id: string | null; finishing_job_id?: string | null; quantity_checked_kg: unknown; status: string };
type Packaging = { id: string; production_job_id: string | null; status: string; profile_weight_kg: unknown };
type Material = { job_id: string; quantity_required: unknown };
function quantity(value: unknown) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) throw new Error("Material readiness contains an invalid observation. Recheck the source records.");
  return number;
}
export function indexDispatchReadiness(inspections: Inspection[], packaging: Packaging[], materials: Material[]) {
  const approvedByJobKg = new Map<string, number>();
  const packagedByJobKg = new Map<string, number>();
  const issuedPackaging = new Set<string>();
  for (const material of materials) if (quantity(material.quantity_required) > 0) issuedPackaging.add(material.job_id);
  for (const inspection of inspections) {
    if (inspection.status !== "approved" || inspection.finishing_job_id || !inspection.production_job_id) continue;
    const key = inspection.production_job_id;
    approvedByJobKg.set(key, (approvedByJobKg.get(key) ?? 0) + quantity(inspection.quantity_checked_kg));
  }
  for (const item of packaging) {
    if (item.status !== "completed" || !item.production_job_id || !issuedPackaging.has(item.id)) continue;
    const key = item.production_job_id;
    packagedByJobKg.set(key, (packagedByJobKg.get(key) ?? 0) + quantity(item.profile_weight_kg));
  }
  return { approvedByJobKg, packagedByJobKg };
}
