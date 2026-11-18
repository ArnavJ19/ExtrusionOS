"use server";

// Autopilot batch 7 server action that calls an outside provider before the database records the result:
// AP-079 emails a prepared statement through the configured email provider (lib/communications/email). The statement is
// recorded as "sent by provider" only after the provider accepted it; without a provider, the person sends it themselves.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/communications/email";
import { STATEMENT_ROLES } from "@/lib/autopilot-batch7/commands";

type Result<T> = { success: true; data: T } | { success: false; error: string };

export async function emailStatementAction(id: string): Promise<Result<{ provider: string }>> {
  try {
    const ctx = await getSessionContext();
    if (ctx.dealerId || !(STATEMENT_ROLES as readonly string[]).includes(ctx.role)) return { success: false, error: "Statements are handled by accounts." };
    const statementId = z.string().uuid().parse(id);
    const supabase = await createClient();
    const read = await supabase.rpc("ap_statement", { p_command: "get", p_payload: { id: statementId } });
    if (read.error) return { success: false, error: read.error.message?.startsWith("AP: ") ? read.error.message.slice(4) : "The statement could not be read." };
    const s = read.data as { status: string; email: string | null; message: string; period_start: string; customer: string };
    if (s.status !== "prepared") return { success: false, error: "Only a prepared statement can be emailed." };
    const to = z.string().email().safeParse(s.email ?? "");
    if (!to.success) return { success: false, error: "The customer has no valid email address. Add it to the customer, or send the statement another way." };
    const month = new Date(`${s.period_start}T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
    const sent = await sendEmail({ to: to.data, subject: `Statement of account for ${month}`, text: s.message });
    if (!sent.success) return { success: false, error: `The email was not sent: ${sent.error}. Download the PDF and send it yourself, then mark it sent.` };
    const recorded = await supabase.rpc("ap_statement", { p_command: "send_provider", p_payload: { id: statementId, provider_ref: `${sent.provider}:${sent.id ?? "accepted"}`.slice(0, 200) } });
    if (recorded.error) return { success: false, error: "The email was accepted by the provider but could not be recorded. Mark the statement sent (email) so it is not sent twice." };
    try { revalidatePath("/payments/statements"); } catch { /* the database outcome stands */ }
    return { success: true, data: { provider: sent.provider } };
  } catch {
    return { success: false, error: "The statement could not be emailed. Check your session and retry." };
  }
}
