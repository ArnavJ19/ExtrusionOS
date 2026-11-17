// FS-38: sends the queued morning owner briefs by email (server only; called by the morning cron route with the service
// role). The database decides who receives a brief and keeps each attempt; this only hands messages to the provider.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailPayload, EmailResult } from "@/lib/communications/email";

type Pending = { id: string; address: string; subject: string; message: string };

export async function deliverOwnerBriefs(admin: SupabaseClient, send: (payload: EmailPayload) => Promise<EmailResult>) {
  const pending = await admin.rpc("fs_brief_outbox", { p_command: "pending", p_payload: {} });
  if (pending.error) return { sent: 0, failed: 0, error: "outbox unavailable" };
  let sent = 0, failed = 0;
  for (const row of (pending.data ?? []) as Pending[]) {
    const result = await send({ to: row.address, subject: row.subject, text: row.message });
    await admin.rpc("fs_brief_outbox", { p_command: "mark", p_payload: result.success ? { id: row.id, state: "sent" } : { id: row.id, state: "failed", error: result.error } });
    if (result.success) sent++; else failed++;
  }
  return { sent, failed };
}
