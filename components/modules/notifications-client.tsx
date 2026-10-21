"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import Link from "next/link";
import type { NotificationAction } from "@/lib/operations/notification-actions";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { markNotificationReadAction } from "@/lib/actions/notifications";
import { formatDate } from "@/lib/utils/format";

export type NotificationInboxItem = {
  id: string;
  title: string;
  body: string | null;
  severity: string;
  createdAt: string;
  isRead: boolean;
  action?: NotificationAction;
};

export function NotificationsClient({ notifications }: { notifications: NotificationInboxItem[] }) {
  const router = useRouter();
  const [readIds, setReadIds] = useState<string[]>([]);
  const items = notifications.map(item => ({ ...item, isRead: item.isRead || readIds.includes(item.id) }));
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function markRead(notificationId: string) {
    setPendingId(notificationId);
    startTransition(async () => {
      const result = await markNotificationReadAction(notificationId);
      if (!result.success) {
        toast.error(result.error);
        setPendingId(null);
        return;
      }

      setReadIds(current => [...new Set([...current, notificationId])]);
      setPendingId(null);
      router.refresh();
    });
  }

  if (!items.length) {
    return (
      <Card>
        <CardContent className="py-12 text-center font-medium text-neutral-500">
          You have no notifications.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {items.map((notification) => (
        <Card key={notification.id} className={notification.action?.state === "resolved" ? "border-emerald-200 bg-emerald-50/30" : notification.isRead ? "opacity-75" : "border-l-4 border-l-blue-500"}>
          <CardContent className="p-4 sm:p-6">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
              <div className="min-w-0 space-y-1 break-words">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className={`font-semibold ${notification.isRead ? "text-neutral-700" : "text-neutral-900"}`}>
                    {notification.title}
                  </h3>
                  {!notification.isRead ? <span className="text-xs font-semibold text-blue-700">New</span> : null}
                  {notification.severity !== "info" && notification.action?.state !== "resolved" ? <Badge value={notification.severity} /> : null}
                  {notification.action?.state === "resolved" ? <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-800">Resolved in source</span> : null}
                </div>
                {notification.body ? <p className="text-sm text-neutral-600">{notification.body}</p> : null}
                {notification.action ? <div className="mt-3 space-y-2 text-sm"><p className={notification.action.state === "resolved" ? "text-emerald-800" : "text-slate-600"}>{notification.action.detail}</p>{notification.action.responsible ? <p className="text-xs text-slate-500">Review with: {notification.action.responsible}</p> : null}{notification.action.href ? <Link className="inline-flex rounded-xl border border-slate-200 px-3 py-2 font-semibold text-slate-950" href={notification.action.href}>{notification.action.label}</Link> : null}</div> : null}
              </div>
              <div className="flex shrink-0 items-center gap-3 sm:flex-col sm:items-end">
                <span className="whitespace-nowrap text-xs text-neutral-400">{formatDate(notification.createdAt)}</span>
                {!notification.isRead ? (
                  <Button
                    type="button"
                    variant="secondary"
                    className="px-3 py-2"
                    disabled={isPending && pendingId === notification.id}
                    onClick={() => markRead(notification.id)}
                  >
                    <Check className="h-4 w-4" />
                    {isPending && pendingId === notification.id ? "Marking..." : "Mark as read"}
                  </Button>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
