import { PageHeader } from "@/components/layout/page-header";
import { NotificationsClient } from "@/components/modules/notifications-client";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { QueryErrorNotice } from "@/components/ui/query-error-notice";

export default async function NotificationsPage() {
  const context = await getSessionContext();
  const supabase = await createClient();

  const { data: notifications, error } = await supabase
    .from("notifications")
    .select("id, recipient_user_id, title, body, severity, is_read, created_at, notification_read_receipts(user_id, read_at)")
    .eq("company_id", context.companyId)
    .or(`recipient_user_id.eq.${context.userId},recipient_user_id.is.null`)
    .order("created_at", { ascending: false })
    .limit(50);

  const inbox = (notifications ?? []).map((notification) => ({
    id: notification.id,
    title: notification.title,
    body: notification.body,
    severity: notification.severity,
    createdAt: notification.created_at,
    isRead: notification.recipient_user_id
      ? notification.is_read
      : (notification.notification_read_receipts ?? []).some((receipt) => receipt.user_id === context.userId)
  }));

  return (
    <div className="space-y-6">
      <PageHeader 
        title="Notifications" 
        description="Your recent alerts and system messages." 
      />
      <QueryErrorNotice messages={error ? [error.message] : []} />

      <NotificationsClient notifications={inbox} />
    </div>
  );
}
