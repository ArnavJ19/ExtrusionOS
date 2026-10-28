import { PageHeader } from "@/components/layout/page-header";
import { NotificationsClient } from "@/components/modules/notifications-client";
import Link from "next/link";
import { loadNotificationActions } from "@/lib/operations/notification-actions";
import { getBusinessDateBoundaries } from "@/lib/utils/business-date";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { QueryErrorNotice } from "@/components/ui/query-error-notice";

export default async function NotificationsPage({ searchParams = Promise.resolve({}) }: { searchParams?: Promise<{ page?: string }> } = {}) {
  const context = await getSessionContext();
  const supabase = await createClient();
  const requested = Number((await searchParams).page ?? 1);
  const page = Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, 100000) : 1;

  const { data: notifications, error, count } = await supabase
    .from("notifications")
    .select("id, recipient_user_id, title, body, severity, is_read, created_at, notification_type, related_entity_type, related_entity_id, entity_reference, notification_read_receipts(user_id, read_at)", { count: "exact" })
    .eq("company_id", context.companyId)
    .or(`recipient_user_id.eq.${context.userId},recipient_user_id.is.null`)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range((page - 1) * 10, page * 10 - 1);

  const actions = await loadNotificationActions(supabase, context, notifications ?? [], getBusinessDateBoundaries().today);

  const inbox = (notifications ?? []).map((notification) => ({
    id: notification.id,
    title: notification.title,
    body: notification.body,
    severity: notification.severity,
    createdAt: notification.created_at,
    action: actions[notification.id],
    isRead: notification.recipient_user_id
      ? notification.is_read
      : (notification.notification_read_receipts ?? []).some((receipt) => receipt.user_id === context.userId)
  }));

  return (
    <div className="space-y-6">
      <PageHeader 
        title="Notifications" 
        description="Your recent alerts and system messages."
        actions={!context.dealerId ? <div className="flex gap-2"><Link href="/notifications/following" className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold">Following</Link><Link href="/notifications/requests" className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold">Action requests</Link></div> : null}
      />
      <QueryErrorNotice messages={error ? [error.message] : []} />

      <NotificationsClient notifications={inbox} />
      {!error ? <nav aria-label="Notification pages" className="flex flex-wrap items-center gap-4 text-sm font-semibold">{page > 1 ? <Link href={`/notifications?page=${page - 1}`}>Previous page</Link> : null}<span>Page {page} · {count === null ? "Count unavailable" : `${count} messages`}</span>{count !== null && page * 10 < count ? <Link href={`/notifications?page=${page + 1}`}>Next page</Link> : null}</nav> : null}
    </div>
  );
}
