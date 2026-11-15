
// AP-095: the signed-in person's floor-screen language, read through the database gateway (their own row only).
// Anything unreadable (gateway not yet migrated, no session) falls back to English.
import { createClient } from "@/lib/supabase/server";
import { parseFloorLanguage, type FloorLanguage } from "@/lib/i18n/floor";

export async function getFloorLanguage(): Promise<FloorLanguage> {
  try {
    const supabase = await createClient();
    const result = await supabase.rpc("ap_language", { p_command: "get", p_payload: {} });
    if (result.error) return "en";
    return parseFloorLanguage((result.data as { language?: string } | null)?.language);
  } catch {
    return "en";
  }
}
