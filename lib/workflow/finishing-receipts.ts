type FinishingReceipt = {
  production_job_id?: string | null;
  status?: string | null;
  output_weight_kg?: number | string | null;
  received_date?: string | null;
};

export function isAcceptedFinishingReceiptForJob(receipt: FinishingReceipt | null | undefined, jobId: string): boolean {
  const output = Number(receipt?.output_weight_kg);
  return Boolean(receipt && receipt.production_job_id === jobId && ["completed", "rejected"].includes(receipt.status ?? "")
    && receipt.received_date && Number.isFinite(output) && output > 0);
}
