import Link from "next/link";
import { autopilotAction } from "@/lib/actions/autopilot";
import { canUseHubAction } from "@/lib/navigation/hub-permissions";
import { HOME_KINDS, HOME_STARTS, HUB_LABELS, homeWorkHref, homeWorkRecordSchema, type HomeKind } from "@/lib/navigation/home-work";

// AP-041: the coordination, lifecycle, assurance, execution, commercial, specialist and control work that belongs to
// this record, read through each hub's own read model and permissions, plus the actions that start from it.
export async function RelatedWorkPanel({ kind, id, role }: { kind: HomeKind; id: string; role: string }) {
  const result = await autopilotAction("ap_home_work", "record", { kind, id });
  const parsed = result.success ? homeWorkRecordSchema.safeParse(result.data) : null;
  const starts = HOME_STARTS[kind].filter(start => canUseHubAction(start.hub, role, start.action));
  if (!parsed?.success && !starts.length) return null;
  const items = parsed?.success ? parsed.data.items : [];
  const hidden = parsed?.success ? parsed.data.groups.reduce((sum, group) => sum + group.total, 0) - items.length : 0;
  return <section aria-labelledby={`related-work-${id}`} className="min-w-0 space-y-3 rounded-2xl border border-neutral-200 bg-white p-4 sm:p-5">
    <div><h2 id={`related-work-${id}`} className="text-lg font-bold">Related work</h2>
      <p className="text-sm text-neutral-600">Follow-ups, reviews and controls recorded against this {HOME_KINDS[kind].label.toLowerCase()}.</p></div>
    {!parsed?.success ? <p role="alert" className="text-sm font-semibold text-amber-900">{result.success ? "Related work could not be read." : result.error}</p>
      : !items.length ? <p className="rounded-xl border border-dashed border-neutral-300 p-3 text-sm text-neutral-600">No related work is recorded yet.</p>
      : <ul className="divide-y rounded-xl border border-neutral-200">{items.map(item => <li key={`${item.hub}:${item.view}:${item.id}`} className="min-w-0 p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2"><Link href={item.href} className="font-semibold underline [overflow-wrap:anywhere]">{item.label ?? "Record"}</Link>
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-bold text-neutral-700">{HUB_LABELS[item.hub]} · {item.view.replaceAll("_", " ")}</span>
          {item.status ? <span className="text-xs font-semibold text-neutral-600">{item.status.replaceAll("_", " ")}</span> : null}</div>
        {item.summary ? <p className="mt-1 text-xs text-neutral-600 [overflow-wrap:anywhere]">{item.summary}</p> : null}
      </li>)}</ul>}
    {hidden > 0 ? <p className="text-xs text-neutral-600">{hidden} more related record(s); open the report under Tasks to see them all.</p> : null}
    {starts.length ? <div><h3 className="text-sm font-bold">Start from this {HOME_KINDS[kind].label.toLowerCase()}</h3>
      <ul className="mt-2 flex flex-wrap gap-2">{starts.map(start => <li key={`${start.hub}:${start.action}`}>
        <Link href={homeWorkHref(kind, id, start.hub, start.action)} className="inline-flex min-h-10 items-center rounded-xl border border-neutral-300 px-3 text-sm font-semibold hover:bg-neutral-50">{start.label}</Link></li>)}</ul></div> : null}
  </section>;
}
