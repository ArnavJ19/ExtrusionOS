import { createClient } from "@supabase/supabase-js";
import { readStagingEnvironment } from "./support/environment.ts";

export default async function globalSetup() {
  const env = readStagingEnvironment();
  const admin = createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const usersResult = await admin
    .from("app_users")
    .select("id, company_id, email, is_active")
    .in("email", [env.primaryEmail, env.secondaryEmail]);
  if (usersResult.error) throw new Error(`Could not resolve staging users: ${usersResult.error.message}`);

  const users = usersResult.data ?? [];
  const primary = users.find((user) => user.email?.toLowerCase() === env.primaryEmail);
  const secondary = users.find((user) => user.email?.toLowerCase() === env.secondaryEmail);
  if (!primary?.is_active || !secondary?.is_active) {
    throw new Error("Both staging E2E users must exist in app_users and be active.");
  }
  if (primary.company_id !== secondary.company_id) {
    throw new Error("Staging E2E users must belong to the same company for notification isolation coverage.");
  }

  const runId = crypto.randomUUID();
  const title = `[STAGING E2E ${runId}] Per-user notification receipt`;
  const notificationResult = await admin
    .from("notifications")
    .insert({
      company_id: primary.company_id,
      recipient_user_id: null,
      notification_type: "system",
      severity: "info",
      title,
      body: "Disposable Playwright fixture. Global teardown removes this notification.",
      created_by: primary.id,
    })
    .select("id")
    .single();
  if (notificationResult.error || !notificationResult.data) {
    throw new Error(`Could not seed staging notification: ${notificationResult.error?.message ?? "unknown error"}`);
  }
  const notificationId = notificationResult.data.id;

  process.env.E2E_STAGING_NOTIFICATION_ID = notificationId;
  process.env.E2E_STAGING_NOTIFICATION_TITLE = title;

  return async () => {
    const cleanup = await admin
      .from("notifications")
      .delete()
      .eq("id", notificationId)
      .eq("company_id", primary.company_id);
    if (cleanup.error) throw new Error(`Could not clean staging notification: ${cleanup.error.message}`);
  };
}
