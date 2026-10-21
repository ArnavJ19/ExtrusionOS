"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils/errors";
import { PRODUCTION_SCRAP_CATEGORIES } from "@/lib/workflow/production-scrap";

// EXOS-AUD-006: completion records weighed scrap by category. Only butt end,
// front/back end, saw cut and rejects become furnace scrap lots (with the job alloy);
// unrecoverable loss is reported but never becomes metal.
const scrapLine = z.object({
  category: z.enum(PRODUCTION_SCRAP_CATEGORIES.map((category) => category.value) as [string, ...string[]]),
  weight_kg: z.coerce.number().min(0, "Scrap weight cannot be negative.")
});

const schema = z.object({
  job_id: z.string().uuid(),
  actual_weight_kg: z.coerce.number().positive("Enter the good output weight."),
  actual_pieces: z.coerce.number().int().min(0),
  actual_meters: z.coerce.number().min(0).nullable().optional(),
  scrap_lines: z.array(scrapLine),
  remarks: z.string().trim().max(500).nullable().optional()
});

export async function completeProductionJobWithScrapAction(input: z.input<typeof schema>) {
  try {
    const context = await getSessionContext();
    if (!can(context.role, "update", "production")) return { success: false as const, error: "You do not have permission to complete production jobs." };
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { success: false as const, error: parsed.error.issues[0]?.message ?? "Please check actual production output." };
    const supabase = await createClient();
    const result = await supabase.rpc("complete_production_job_with_scrap_atomic", {
      p_job_id: parsed.data.job_id,
      p_actual_weight_kg: parsed.data.actual_weight_kg,
      p_actual_pieces: parsed.data.actual_pieces,
      p_actual_meters: parsed.data.actual_meters ?? null,
      p_scrap_lines: parsed.data.scrap_lines.filter((line) => line.weight_kg > 0),
      p_remarks: parsed.data.remarks || null
    });
    if (result.error || !result.data) throw result.error ?? new Error("Could not complete production job");
    for (const path of ["/production", "/production/database", "/production/schedule", `/production/${parsed.data.job_id}`, "/production/finishing", "/packaging", "/quality", "/foundry/scrap"]) revalidatePath(path);
    return { success: true as const, jobId: parsed.data.job_id };
  } catch (error) {
    return { success: false as const, error: getErrorMessage(error, "Could not complete production job") };
  }
}
