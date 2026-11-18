"use server";

// Phase 4 gateway (FABLE_SUGGESTIONS FS-16/26/27/38/54/68/71/72). Every command is allow-listed and validated here, then
// re-checked by the database function, which takes the company, the actor and the role from the session. Only
// messages the database marks with "AP: " are shown to people.
import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { INTELLIGENCE_COMMANDS, INTELLIGENCE_PATHS, INTELLIGENCE_READS, type IntelligenceGateway } from "@/lib/intelligence/commands";

export type FsResult<T = unknown> = { success: true; data: T } | { success: false; error: string; unavailable?: boolean };

function friendly(error: { code?: string; message?: string } | null | undefined): FsResult<never> {
  const code = error?.code ?? "", message = error?.message ?? "";
  if (["PGRST202", "42883", "42P01"].includes(code)) return { success: false, unavailable: true, error: "This needs the Phase 4 database upgrade. Existing workflows remain available." };
  if (code === "42501") return { success: false, error: "This record or action is not available to your current session." };
  if ((code === "P0001" || code === "23514") && message.startsWith("AP: ")) return { success: false, error: message.slice(4) };
  if (["23505", "23514", "23503", "22P02", "22007", "22008", "22003"].includes(code)) return { success: false, error: "The details conflict with current records. Reload and review again." };
  return { success: false, error: "The request could not be completed. Check your connection and retry." };
}

export async function intelligenceAction(rpc: string, command: string, payload: unknown = {}): Promise<FsResult> {
  try {
    const schemas = (INTELLIGENCE_COMMANDS as Record<string, Record<string, import("zod").ZodTypeAny>>)[rpc];
    const schema = schemas?.[command];
    if (!schema) return { success: false, error: "Unknown request." };
    const parsed = schema.safeParse(payload ?? {});
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Review the details." };
    const context = await getSessionContext();
    if (context.dealerId || ["dealer_admin", "dealer_staff"].includes(context.role)) return { success: false, error: "This action is not permitted for your current session." };
    const supabase = await createClient();
    const result = await supabase.rpc(rpc, { p_command: command, p_payload: parsed.data });
    if (result.error) return friendly(result.error);
    if (!INTELLIGENCE_READS.has(command)) for (const path of INTELLIGENCE_PATHS[rpc as IntelligenceGateway] ?? []) { try { revalidatePath(path); } catch { /* the database outcome stands */ } }
    return { success: true, data: result.data };
  } catch {
    return { success: false, error: "The request could not be completed. Check your session and retry." };
  }
}

/** FS-16: a short-lived link to a correction photo. The gateway checks the company and role; storage policy checks the path. */
export async function correctionPhotoUrlAction(stepId: string): Promise<FsResult<{ url: string }>> {
  const located = await intelligenceAction("fs_die_life", "photo", { step_id: stepId });
  if (!located.success) return located;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.storage.from("documents").createSignedUrl((located.data as { path: string }).path, 300);
    if (error || !data?.signedUrl) return { success: false, error: "The photo could not be opened. Retry." };
    return { success: true, data: { url: data.signedUrl } };
  } catch {
    return { success: false, error: "The photo could not be opened. Retry." };
  }
}
