import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const identity = z.string().uuid().transform(value => value.toLowerCase());
const materialRow = z.object({
  id: identity,
  company_id: identity,
  production_job_id: identity,
  weight_kg: z.union([z.number(), z.string()]),
});
const billetRow = materialRow.extend({status: z.enum(["allocated", "issued", "consumed"])});
const jobIdentity = z.object({id: identity, company_id: identity, status: z.string().min(1)});

// These quantities are recorded to three decimal places in the production ledger.
function milliKg(value: unknown): number {
  if (typeof value !== "number" && typeof value !== "string") {
    throw new Error("Production evidence contains an invalid recorded weight.");
  }
  const text = String(value).trim();
  if (!/^\d+(\.\d{1,3})?$/.test(text)) throw new Error("Production evidence contains an invalid recorded weight.");
  const [whole, fraction = ""] = text.split(".");
  const result = Number(whole) * 1000 + Number(fraction.padEnd(3, "0"));
  if (!Number.isSafeInteger(result)) {
    throw new Error("Production evidence contains an unsupported recorded weight.");
  }
  return result;
}

async function loadMaterialTotal(
  client: Pick<SupabaseClient, "from">, table: "foundry_billets" | "scrap_records", companyId: string, jobId: string
): Promise<{milli: number; count: number}> {
  let expected: number | null = null;
  let previousId = "";
  let total = 0;
  const pageSize = 200;
  for (let offset = 0; ;) {
    let query = client.from(table)
      .select(`id, company_id, production_job_id, weight_kg${table === "foundry_billets" ? ", status" : ""}`, {count: "exact"})
      .eq("company_id", companyId).eq("production_job_id", jobId)
      .order("id", {ascending: true}).range(offset, offset + pageSize - 1);
    if (table === "foundry_billets") query = query.in("status", ["allocated", "issued", "consumed"]);
    const result = await query;
    if (result.error) throw new Error("Production material history is unavailable. Refresh before generating the report.");
    if (!Array.isArray(result.data) || typeof result.count !== "number" || !Number.isSafeInteger(result.count)
      || result.count < 0 || result.count > 100000 || (expected !== null && expected !== result.count)) {
      throw new Error("The complete production material history could not be verified. Refresh before generating the report.");
    }
    const count: number = result.count;
    expected = count;
    const remaining = Math.min(pageSize, Math.max(count - offset, 0));
    if (result.data.length > remaining || (remaining > 0 && result.data.length === 0)) {
      throw new Error("Production material history is incomplete. Refresh before generating the report.");
    }
    for (const value of result.data) {
      const parsed = (table === "foundry_billets" ? billetRow : materialRow).safeParse(value);
      if (!parsed.success) throw new Error("Production evidence has invalid material identities or weights.");
      const row = parsed.data;
      if (row.company_id !== companyId || row.production_job_id !== jobId || row.id <= previousId) {
        throw new Error("Production evidence has conflicting material identities. Refresh before generating the report.");
      }
      previousId = row.id;
      const weight = milliKg(row.weight_kg);
      if (table === "foundry_billets" && weight === 0) throw new Error("Production evidence contains a billet without positive recorded weight.");
      total += weight;
      if (!Number.isSafeInteger(total)) throw new Error("Production evidence weights exceed the supported range.");
    }
    offset += result.data.length;
    if (offset === count) return {milli: total, count};
  }
}

export async function loadProductionBatchEvidence(
  client: Pick<SupabaseClient, "from">, job: Record<string, unknown>, companyId: string, jobId: string
) {
  const company = identity.parse(companyId);
  const jobKey = identity.parse(jobId);
  const parsed = jobIdentity.safeParse(job);
  if (!parsed.success || parsed.data.id !== jobKey || parsed.data.company_id !== company) {
    throw new Error("Production job identity could not be verified.");
  }
  const input = await loadMaterialTotal(client, "foundry_billets", company, jobKey);
  const scrap = await loadMaterialTotal(client, "scrap_records", company, jobKey);

  // Completion/corrections can change final output while the separate REST reads run.
  const latest = await client.from("production_jobs_authorized")
    .select("id, company_id, status, actual_quantity_kg, updated_at, order_id, profile_id")
    .eq("company_id", company).eq("id", jobKey).single();
  const revisionFields = ["id", "company_id", "status", "actual_quantity_kg", "updated_at", "order_id", "profile_id"] as const;
  if (latest.error || !latest.data || revisionFields.some(key => latest.data[key] !== job[key])) {
    throw new Error("Production job changed or could not be rechecked. Refresh before generating the report.");
  }

  const completed = job.status === "completed";
  const capturedOutput = job.actual_quantity_kg == null ? null : milliKg(job.actual_quantity_kg);
  const output = capturedOutput !== null && capturedOutput > 0 ? capturedOutput : null;
  const inputKg = input.count > 0 ? input.milli / 1000 : null;
  // An empty ledger is zero recorded scrap only with a completed, captured input/output.
  // The balance difference still exposes unaccounted loss; physical zero loss is not inferred.
  const scrapKg = scrap.count > 0 || (completed && inputKg !== null && output !== null) ? scrap.milli / 1000 : null;
  const finalEvidence = completed && inputKg !== null && output !== null;
  const differenceMilli = finalEvidence ? input.milli - output - scrap.milli : null;
  if (differenceMilli !== null && !Number.isSafeInteger(differenceMilli)) throw new Error("Production evidence balance exceeds the supported range.");
  const difference = differenceMilli === null ? null : differenceMilli / 1000;
  const tolerance = finalEvidence ? Math.max(0.5, Math.round(input.milli * 0.01) / 1000) : null;
  const percent = (milli: number) => Math.round(milli / input.milli * 100000) / 1000;
  return {
    inputKg,
    outputKg: output === null ? null : output / 1000,
    scrapKg,
    recoveryPercent: finalEvidence ? percent(output) : null,
    scrapPercent: finalEvidence ? percent(scrap.milli) : null,
    billetCount: input.count,
    scrapCount: scrap.count,
    differenceKg: difference,
    toleranceKg: tolerance,
    reconciliation: !completed ? "Pending production completion"
      : !finalEvidence ? "Billet input or final output not captured"
      : Math.abs(difference!) <= tolerance! ? "Within production tolerance" : "Review recorded mass balance",
  };
}
