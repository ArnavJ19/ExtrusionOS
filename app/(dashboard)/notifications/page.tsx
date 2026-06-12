import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils/format";
import { Badge } from "@/components/ui/badge";

export default async function NotificationsPage() {
  const context = await getSessionContext();
  const supabase = await createClient();

  // Load all notifications for the user
  const { data: notifications, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("company_id", context.companyId)
    .eq("recipient_user_id", context.userId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("Failed to fetch notifications:", error);
  }

  return (
    <div className="space-y-6">
      <PageHeader 
        title="Notifications" 
        description="Your recent alerts and system messages." 
      />

      <div className="flex flex-col gap-4">
        {!notifications?.length ? (
          <Card>
            <CardContent className="py-12 text-center text-neutral-500 font-medium">
              You have no notifications.
            </CardContent>
          </Card>
        ) : (
          notifications.map((notification) => (
            <Card key={notification.id} className={notification.is_read ? "opacity-75" : "border-l-4 border-l-blue-500"}>
              <CardContent className="p-4 sm:p-6">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h3 className={`font-semibold ${notification.is_read ? "text-neutral-700" : "text-neutral-900"}`}>
                        {notification.title}
                      </h3>
                      {notification.severity !== 'info' && (
                        <Badge 
                          value={notification.severity} 
                        />
                      )}
                    </div>
                    {notification.body && (
                      <p className="text-sm text-neutral-600">
                        {notification.body}
                      </p>
                    )}
                  </div>
                  <div className="text-xs text-neutral-400 whitespace-nowrap">
                    {formatDate(notification.created_at)}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
