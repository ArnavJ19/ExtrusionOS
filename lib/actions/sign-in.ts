"use server";

// FS-51: password sign-in on the server. Before Supabase Auth is asked, the request is rate-limited per address and
// e-mail, and an account with five failed sign-ins in 15 minutes is refused for 15 minutes. Failures are recorded
// against the staff account (never revealing whether an e-mail exists); a success is recorded with the address and
// browser taken from the request headers, not from the browser.
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/utils/rate-limit";

const schema = z.object({ email: z.string().trim().toLowerCase().email("Enter your e-mail address").max(254), password: z.string().min(1, "Enter your password").max(200) });
export type SignInResult = { success: true } | { success: false; error: string };

const GENERIC = "E-mail or password is incorrect.";
const LOCKED = "Too many failed sign-ins for this account. Wait 15 minutes, or ask the owner to check your access.";

export async function signInAction(input: { email: string; password: string }): Promise<SignInResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? GENERIC };
  const { email, password } = parsed.data;
  const h = await headers();
  const ip = (h.get("x-vercel-forwarded-for") ?? h.get("x-real-ip") ?? h.get("x-forwarded-for") ?? "").split(",")[0]?.trim().slice(0, 64) || null;
  const userAgent = h.get("user-agent")?.slice(0, 300) ?? null;

  const limit = await checkRateLimit(createHash("sha256").update(`sign-in:${ip ?? "unknown"}:${email}`).digest("hex"), { limit: 10, windowSeconds: 900 });
  if (!limit.allowed) return { success: false, error: limit.available ? LOCKED : "Sign-in protection is temporarily unavailable. Try again shortly." };

  let admin: ReturnType<typeof createAdminClient> | null = null;
  try { admin = createAdminClient(); } catch { admin = null; }
  if (admin) {
    const check = await admin.rpc("fs_security_service", { p_command: "check", p_payload: { email } });
    if (!check.error && (check.data as { locked?: boolean } | null)?.locked) return { success: false, error: LOCKED };
  }

  const supabase = await createClient();
  const result = await supabase.auth.signInWithPassword({ email, password });
  if (result.error || !result.data.session) {
    if (admin) {
      const failed = await admin.rpc("fs_security_service", { p_command: "failed", p_payload: { email, ip, user_agent: userAgent } });
      if (!failed.error && (failed.data as { locked?: boolean } | null)?.locked) return { success: false, error: LOCKED };
    }
    return { success: false, error: GENERIC };
  }
  // Recording the sign-in must not block it.
  await supabase.rpc("fs_security", { p_command: "login_success", p_payload: { ip, user_agent: userAgent } }).then(() => undefined, () => undefined);
  return { success: true };
}
