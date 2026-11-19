"use server";

// FABLE_SUGGESTIONS batch 4 gateway (FS-07/51/65/75/77/79/132). Every command is allow-listed and validated here, then
// re-checked by the database function, which takes the company, the actor and the role from the session. Only messages
// the database marks with "AP: " are shown to people.
import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { BATCH4_COMMANDS, BATCH4_PATHS, BATCH4_READS, type Batch4Gateway } from "@/lib/fs-batch4/commands";

export type B4Result<T = unknown> = { success: true; data: T } | { success: false; error: string; unavailable?: boolean };

function friendly(error: { code?: string; message?: string } | null | undefined): B4Result<never> {
  const code = error?.code ?? "", message = error?.message ?? "";
  if (["PGRST202", "42883", "42P01"].includes(code)) return { success: false, unavailable: true, error: "This needs the FS batch 4 database upgrade. Existing workflows remain available." };
  if (code === "42501" && message.startsWith("AP: ")) return { success: false, error: message.slice(4) };
  if (code === "42501") return { success: false, error: "This record or action is not available to your current session." };
  if ((code === "P0001" || code === "23514") && message.startsWith("AP: ")) return { success: false, error: message.slice(4) };
  if (["23505", "23514", "23503", "22P02", "22007", "22008", "22003"].includes(code)) return { success: false, error: "The details conflict with current records. Reload and review again." };
  return { success: false, error: "The request could not be completed. Check your connection and retry." };
}

export async function fsBatch4Action(rpc: string, command: string, payload: unknown = {}): Promise<B4Result> {
  try {
    const schemas = (BATCH4_COMMANDS as Record<string, Record<string, import("zod").ZodTypeAny>>)[rpc];
    const schema = schemas?.[command];
    if (!schema) return { success: false, error: "Unknown request." };
    const parsed = schema.safeParse(payload ?? {});
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Review the details." };
    const context = await getSessionContext();
    if (context.dealerId || ["dealer_admin", "dealer_staff"].includes(context.role)) return { success: false, error: "This action is not permitted for your current session." };
    const supabase = await createClient();
    const result = await supabase.rpc(rpc, { p_command: command, p_payload: parsed.data });
    if (result.error) return friendly(result.error);
    if (!BATCH4_READS.has(command)) for (const path of BATCH4_PATHS[rpc as Batch4Gateway] ?? []) { try { revalidatePath(path); } catch { /* the database outcome stands */ } }
    return { success: true, data: result.data };
  } catch {
    return { success: false, error: "The request could not be completed. Check your session and retry." };
  }
}
