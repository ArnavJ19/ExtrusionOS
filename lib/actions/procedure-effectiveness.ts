"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { effectivenessCommandSchema } from "@/lib/workflow/procedure-effectiveness";

export async function procedureEffectivenessAction(input: unknown) {
  try {
    const context = await getSessionContext();
    const parsed = effectivenessCommandSchema.safeParse(input);
    if (!parsed.success) return { success: false as const, error: parsed.error.issues[0]?.message ?? "Review the details." };
    const { command, ...payload } = parsed.data;
    if (context.dealerId || context.role.startsWith("dealer_") || !can(context.role, "read", "tasks") || (context.role === "viewer" && !["outcomes", "flags.list", "improvements.list", "improvement.load"].includes(command))) return { success: false as const, error: "You do not have permission for this action." };
    const supabase = await createClient();
    const result = await supabase.rpc("procedure_effectiveness_command", { p_command: command, p_payload: payload });
    if (result.error) {
      const message = result.error.message ?? "";
      if (["PGRST202", "42883", "42P01"].includes(result.error.code ?? "")) return { success: false as const, error: "SOP effectiveness review is unavailable. Contact your administrator." };
      return { success: false as const, error: ["P0001", "42501"].includes(result.error.code ?? "") && message.length < 240 ? message : "This change could not be confirmed. Reload the record before retrying." };
    }
    if (!["outcomes", "flags.list", "improvements.list", "improvement.load"].includes(command)) { try { revalidatePath("/tasks", "layout"); } catch { /* The database already confirmed the write. */ } }
    return { success: true as const, data: result.data as unknown };
  } catch { return { success: false as const, error: "The request could not be confirmed. Reload before retrying." }; }
}
