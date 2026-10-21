import Link from "next/link";
import { ArrowUpRight, CalendarDays, CircleAlert, ListChecks, UsersRound } from "lucide-react";
import { workDateLabel, type MyWork, type WorkQueue } from "@/lib/dashboard/my-work";

export function MyWorkToday({ work, name, role }: { work: MyWork; name: string; role: string }) {
  const date = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${work.today}T00:00:00Z`));
  return (
    <section aria-labelledby="my-work-heading" className="space-y-6">
      <div className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-7">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-semibold text-neutral-500">
          <span className="inline-flex items-center gap-2"><CalendarDays aria-hidden="true" className="h-4 w-4" />{date}</span>
          <span className="capitalize">{role.replaceAll("_", " ")}</span>
        </div>
        <h1 id="my-work-heading" className="mt-4 text-3xl font-bold tracking-tight text-neutral-950 sm:text-4xl">My Work Today</h1>
        <p className="mt-3 max-w-2xl break-words text-sm font-medium leading-6 text-neutral-500">{name ? `${name}, start` : "Start"} with your assignments, then review work waiting for your team. Open a record to continue its workflow.</p>
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-2">
        <div className="min-w-0 space-y-6">
          <Queue work={work.assigned} today={work.today} personal />
          <details className="rounded-3xl border border-neutral-200 bg-white shadow-sm">
            <summary className="cursor-pointer rounded-3xl p-5 text-sm font-bold text-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
              <span className="ml-2">Unassigned team tasks</span>
              <span className="ml-2 text-xs font-medium text-neutral-500">{queueCountLabel(work.unassigned)}</span>
            </summary>
            <Queue work={work.unassigned} today={work.today} embedded />
          </details>
        </div>
        <div className="min-w-0 space-y-6">
          {work.departments.length ? work.departments.map((value) => <Queue key={value.key} work={value} today={work.today} />) : (
            <div className="rounded-3xl border border-neutral-200 bg-white p-5 text-sm leading-6 text-neutral-500">No department queue is available for your current workspace access. Open your assignments or review the separate unassigned team tasks.</div>
          )}
        </div>
      </div>
    </section>
  );
}

function Queue({ work, today, personal = false, embedded = false }: { work: WorkQueue; today: string; personal?: boolean; embedded?: boolean }) {
  const Icon = personal ? ListChecks : UsersRound;
  return (
    <section aria-label={work.title} className={embedded ? "px-5 pb-5" : "overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm"}>
      <div className={embedded ? "mb-4" : "border-b border-neutral-100 p-5"}>
        {!embedded ? <div className="flex items-start justify-between gap-3"><h2 className="flex min-w-0 items-center gap-2 text-base font-bold text-neutral-950"><Icon aria-hidden="true" className="h-5 w-5 shrink-0 text-neutral-400" />{work.title}</h2><span className="shrink-0 rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-neutral-500">{queueCountLabel(work)}</span></div> : null}
        <p className="mt-2 text-sm leading-6 text-neutral-500">{work.description}</p>
      </div>
      {work.error ? (
        <div role="status" className="m-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">{work.error}</div>
      ) : work.items.length ? (
        <ul className="divide-y divide-neutral-100">
          {work.items.map((item) => {
            const dateLabel = workDateLabel(item, today);
            return (
              <li key={item.id} className="p-4 sm:p-5">
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold capitalize text-neutral-500">
                  <span className="rounded-md bg-neutral-100 px-2 py-1">{item.status.replaceAll("_", " ")}</span>
                  {item.priority && ["urgent", "high"].includes(item.priority) ? <span className="rounded-md bg-amber-50 px-2 py-1 text-amber-900">{item.priority} priority</span> : null}
                </div>
                <h3 className="mt-2 break-words text-sm font-bold leading-6 text-neutral-950">{item.title}</h3>
                {dateLabel ? <p className={`mt-1 text-xs font-medium ${dateLabel.startsWith("Overdue") ? "text-rose-700" : "text-neutral-500"}`}>{dateLabel}</p> : null}
                {item.blocker ? <p className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs font-medium leading-5 text-amber-950"><CircleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />{item.blocker}</p> : null}
                <Link href={item.href} className="mt-3 inline-flex min-h-11 max-w-full items-center gap-2 rounded-xl border border-neutral-200 px-3 py-2 text-sm font-semibold text-neutral-800 transition hover:border-neutral-950 hover:bg-neutral-950 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"><span>{item.actionLabel}</span><ArrowUpRight aria-hidden="true" className="h-4 w-4 shrink-0" /><span className="sr-only">: {item.title}</span></Link>
              </li>
            );
          })}
        </ul>
      ) : <p className="p-5 text-sm leading-6 text-neutral-500">{personal ? "No open assignments for you. Review the separate team queues for other available work." : "No matching open work in this queue."}</p>}
      <div className={embedded ? "mt-3" : "border-t border-neutral-100 p-4"}>
        <Link href={work.href} className="inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-semibold text-neutral-700 underline decoration-neutral-300 underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">{work.hasMore ? "View full queue" : "Open workspace"}<ArrowUpRight aria-hidden="true" className="h-4 w-4" /></Link>
      </div>
    </section>
  );
}

function queueCountLabel(work: WorkQueue) {
  if (work.error) return "Unavailable";
  return work.hasMore ? `First ${work.items.length}` : `${work.items.length} shown`;
}
