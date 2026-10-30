"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils/errors";
import {
  configurationReleaseActionInputSchema,
  configurationReleaseResultSchema,
  type ConfigurationReleaseActionInput,
  type ConfigurationReleaseResult
} from "@/lib/workflow/configuration-release";

type ActionResult = { success: true; data: ConfigurationReleaseResult } | { success: false; error: string };

export async function configurationReleaseAction(input: ConfigurationReleaseActionInput): Promise<ActionResult> {
  try {
    const parsed = configurationReleaseActionInputSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Check the configurator release request." };
    const context = await getSessionContext();
    if (!context.companyId || !context.userId || context.dealerId) return { success: false, error: "Configurator release requires an authenticated company employee." };
    if (parsed.data.command === "release.load"
      && !["owner", "admin", "factory_manager", "production_manager", "sales_manager", "sales", "accounts", "viewer"].includes(context.role)) {
      return { success: false, error: "Your role cannot view configurator release readiness." };
    }
    if (parsed.data.command === "release.approve" && !["owner", "admin"].includes(context.role)) {
      return { success: false, error: "Only an owner or admin can approve a configurator release." };
    }

    const supabase = await createClient();
    const result = await supabase.rpc("configuration_release_command", {
      p_command: parsed.data.command,
      p_payload: parsed.data.payload
    });
    if (result.error || !result.data) throw result.error ?? new Error("Configurator release returned no result");
    const data = configurationReleaseResultSchema.parse(result.data);
    if (parsed.data.command === "release.approve") revalidatePath("/systems-configurator/projects");
    return { success: true, data };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not complete the configurator release action") };
  }
}
