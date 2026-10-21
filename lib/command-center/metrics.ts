export type CompletedProductionJob = {
  id: string;
  actual_quantity_kg: number | string | null;
};

export type IssuedBillet = {
  production_job_id: string | null;
  weight_kg: number | string | null;
  /** Weighed after casting (EXOS-AUD-001); preferred over the theoretical weight. */
  measured_weight_kg?: number | string | null;
};

/** QC-rejected kg of a completed job; recovery counts good output only (KPI dictionary). */
export type RejectedQuantity = {
  production_job_id: string | null;
  quantity_checked_kg: number | string | null;
};

export type RecoveryMetric = {
  percent: number | null;
  issuedInputKg: number;
  capturedOutputKg: number;
  capturedJobCount: number;
  missingJobCount: number;
};

/**
 * Recovery is only reportable when every completed job in scope has positive,
 * job-linked billet input. Mixing captured output with an estimated
 * output-plus-scrap denominator would produce a plausible but false KPI.
 */
export function calculateIssuedBilletRecovery(
  jobs: CompletedProductionJob[],
  billets: IssuedBillet[],
  rejections: RejectedQuantity[] = [],
): RecoveryMetric {
  const rejectedByJob = new Map<string, number>();
  for (const rejection of rejections) {
    if (!rejection.production_job_id) continue;
    const kg = Number(rejection.quantity_checked_kg ?? 0);
    if (!Number.isFinite(kg) || kg <= 0) continue;
    rejectedByJob.set(rejection.production_job_id, (rejectedByJob.get(rejection.production_job_id) ?? 0) + kg);
  }
  const inputByJob = new Map<string, number>();
  for (const billet of billets) {
    if (!billet.production_job_id) continue;
    const weight = Number(billet.measured_weight_kg ?? billet.weight_kg ?? 0);
    if (!Number.isFinite(weight) || weight <= 0) continue;
    inputByJob.set(billet.production_job_id, (inputByJob.get(billet.production_job_id) ?? 0) + weight);
  }

  let issuedInputKg = 0;
  let capturedOutputKg = 0;
  let capturedJobCount = 0;
  let missingJobCount = 0;

  for (const job of jobs) {
    const input = inputByJob.get(job.id) ?? 0;
    const output = Number(job.actual_quantity_kg ?? 0) - (rejectedByJob.get(job.id) ?? 0);
    if (input <= 0 || !Number.isFinite(output) || output < 0) {
      missingJobCount += 1;
      continue;
    }
    issuedInputKg += input;
    capturedOutputKg += output;
    capturedJobCount += 1;
  }

  return {
    percent: capturedJobCount > 0 && missingJobCount === 0 && issuedInputKg > 0
      ? (capturedOutputKg / issuedInputKg) * 100
      : null,
    issuedInputKg,
    capturedOutputKg,
    capturedJobCount,
    missingJobCount,
  };
}
