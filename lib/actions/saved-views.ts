"use server";

// AP-092: a person's named list views and their default view per page. Validated here, then by public.ap_views, which
// takes the person from the session: a view is only ever read or changed by the person who saved it.
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { viewCommands } from "@/lib/autopilot-batch8/commands";

export type SavedView = { id: string; name: string; query: string; is_default: boolean; updated_at?: string };
type Result<T> = { success: true; data: T } | { success: false; error: string; unavailable?: boolean };

async function run<T>(command: keyof typeof viewCommands, payload: unknown): Promise<Result<T>> {
  try {
    const parsed = (viewCommands[command] as z.ZodTypeAny).safeParse(payload);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Review the view." };
    const context = await getSessionContext();
    if (context.dealerId) return { success: false, error: "Saved views are not available for this session." };
    const supabase = await createClient();
    const result = await supabase.rpc("ap_views", { p_command: command, p_payload: parsed.data });
    if (result.error) {
      if (["PGRST202", "42883"].includes(result.error.code ?? "")) return { success: false, unavailable: true, error: "Saved views need the Autopilot database upgrade." };
      return { success: false, error: result.error.code === "P0001" && result.error.message.startsWith("AP: ") ? result.error.message.slice(4) : "The view could not be saved. Retry in a moment." };
    }
    return { success: true, data: result.data as T };
  } catch {
    return { success: false, error: "The view could not be saved. Check your session and retry." };
  }
}

export async function listViewsAction(pageKey: string) { return run<{ views: SavedView[] }>("list", { page_key: pageKey }); }
export async function defaultViewAction(pageKey: string) { return run<{ view: SavedView | null }>("default", { page_key: pageKey }); }
export async function saveViewAction(input: { page_key: string; name: string; query: string; make_default?: boolean }) { return run<SavedView>("save", input); }
export async function setDefaultViewAction(id: string) { return run<{ id: string }>("set_default", { id }); }
export async function clearDefaultViewAction(pageKey: string) { return run<{ cleared: boolean }>("clear_default", { page_key: pageKey }); }
export async function deleteViewAction(id: string) { return run<{ deleted: boolean }>("delete", { id }); }
