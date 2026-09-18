"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils/errors";

const releaseSchema = z.object({
  queue_ids: z.array(z.string().uuid()).min(1, "Select at least one queued order"),
  mode: z.enum(["consolidate", "override"]),
  group_code: z.string().trim().max(80).optional().default(""),
  reason: z.string().trim().max(500).optional().default("")
});

export async function releaseFactoryLoadsAction(input: z.input<typeof releaseSchema>) {
  try {
    const context = await getSessionContext();
    if (!["owner", "admin", "factory_manager", "production_manager"].includes(context.role)) {
      return { success: false as const, error: "Only an owner or factory/production manager can release factory loads." };
    }
    const parsed = releaseSchema.safeParse(input);
    if (!parsed.success) return { success: false as const, error: parsed.error.issues[0]?.message ?? "Check the selected loads." };
    if (parsed.data.mode === "consolidate" && !parsed.data.group_code) {
      return { success: false as const, error: "Enter the combined load or furnace group reference." };
    }
    if (parsed.data.mode === "override" && parsed.data.reason.length < 8) {
      return { success: false as const, error: "Enter a clear manager override reason." };
    }
    const supabase = await createClient();
    const result = await supabase.rpc("release_factory_loads_atomic", {
      p_queue_ids: parsed.data.queue_ids,
      p_group_code: parsed.data.group_code || null,
      p_override: parsed.data.mode === "override",
      p_reason: parsed.data.reason || null
    });
    if (result.error) throw result.error;
    revalidatePath("/production/consolidation");
    revalidatePath("/production");
    revalidatePath("/orders");
    return { success: true as const, releasedCount: Number(result.data ?? 0) };
  } catch (error) {
    return { success: false as const, error: getErrorMessage(error, "Could not release factory loads") };
  }
}
