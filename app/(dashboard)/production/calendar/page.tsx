import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { CalendarClient } from "@/components/modules/autopilot/calendar-client";
import { autopilotAction } from "@/lib/actions/autopilot";
import { getSessionContext } from "@/lib/auth";
import { calendarReadSchema, plusDays } from "@/lib/calendar/working-time";
import { getBusinessDateBoundaries } from "@/lib/utils/business-date";

export default async function FactoryCalendarPage() {
  await getSessionContext();
  const today = getBusinessDateBoundaries(new Date()).today;
  const result = await autopilotAction("ap_calendar", "read", { from: today, to: plusDays(today, 365) });
  const parsed = result.success ? calendarReadSchema.safeParse(result.data) : null;
  return <div className="space-y-5">
    <PageHeader title="Factory calendar" description="Working days, shifts, holidays and planned shutdowns used by delivery proposals and capacity."
      actions={<Link href="/production" className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">Back to production</Link>} />
    {parsed?.success ? <CalendarClient initial={parsed.data} today={today} />
      : <p role="alert" className="rounded-2xl bg-amber-50 p-4 text-sm font-semibold text-amber-900">{result.success ? "The calendar returned an unexpected result." : result.error}</p>}
  </div>;
}
