"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils/errors";

const resolveReworkSchema = z.object({
  inspection_id: z.string().uuid(),
  approved_weight_kg: z.coerce.number().nonnegative(),
  rejected_weight_kg: z.coerce.number().nonnegative(),
  inspector_name: z.string().trim().min(1).max(120),
  reason: z.string().trim().min(8).max(2000)
});

export async function resolveQualityReworkAction(input: z.input<typeof resolveReworkSchema>) {
  try {
    const context = await getSessionContext();
    if (!["owner", "admin", "factory_manager", "quality_manager", "quality"].includes(context.role)) {
      return { success: false as const, error: "You do not have permission to resolve quality rework." };
    }
    const parsed = resolveReworkSchema.safeParse(input);
    if (!parsed.success) return { success: false as const, error: parsed.error.issues[0]?.message ?? "Check the rework quantities." };
    if (Math.abs(parsed.data.approved_weight_kg + parsed.data.rejected_weight_kg) < 0.0005) {
      return { success: false as const, error: "Approved and rejected kilograms must account for the original rework quantity." };
    }

    const supabase = await createClient();
    const result = await supabase.rpc("resolve_quality_rework_atomic", {
      p_inspection_id: parsed.data.inspection_id,
      p_approved_weight_kg: parsed.data.approved_weight_kg,
      p_rejected_weight_kg: parsed.data.rejected_weight_kg,
      p_inspector_name: parsed.data.inspector_name,
      p_reason: parsed.data.reason
    });
    if (result.error || !result.data) throw result.error ?? new Error("Could not resolve quality rework");
    revalidatePath("/quality");
    revalidatePath("/dispatches/new");
    return { success: true as const, resolutionId: String(result.data) };
  } catch (error) {
    return { success: false as const, error: getErrorMessage(error, "Could not resolve quality rework") };
  }
}
