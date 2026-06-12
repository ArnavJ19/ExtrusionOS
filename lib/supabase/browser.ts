import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublishableKey, getSupabaseUrl } from "./config";

export function createClient() {
  return createBrowserClient<any>(
    getSupabaseUrl(),
    getSupabasePublishableKey()
  );
}
