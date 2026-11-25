import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { FloorLanguageToggle } from "@/components/modules/autopilot-batch9/floor-language";
import { LiveRefresh } from "@/components/modules/intelligence/live";
import { getSessionContext } from "@/lib/auth";
import { diePreparationAction } from "@/lib/actions/orchestration";
import { floorText, isFloorKey, type FloorKey } from "@/lib/i18n/floor";
import { getFloorLanguage } from "@/lib/i18n/floor-server";
import { PREP_STATUS_LABELS, canReadOrchestration, prepListSchema } from "@/lib/workflow/orchestration";

const at = (value: string | null) => (value ? new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const FILTERS = ["live", "required", "blocked", "prepared", "ready", "issued", "all"] as const;

export default async function DiePreparationPage({ searchParams }: { searchParams: Promise<{ status?: string; page?: string }> }) {
  const [q, context, lang] = await Promise.all([searchParams, getSessionContext(), getFloorLanguage()]);
  if (context.dealerId || !canReadOrchestration(context.role)) redirect("/dies");
  const t = floorText(lang);
  const status = FILTERS.includes(q.status as (typeof FILTERS)[number]) ? q.status! : "live";
  const page = Math.min(Math.max(Number.parseInt(q.page ?? "1", 10) || 1, 1), 100000);
  const result = await diePreparationAction({ command: "prep.list", status, page });
  const parsed = result.success ? prepListSchema.safeParse(result.data) : null;
  const list = parsed?.success ? parsed.data : null;
  const href = (p: number) => `?${new URLSearchParams({ status, page: String(p) })}`;
  const prepLabel = (s: string) => (isFloorKey(`olo.prep.${s}`) ? t(`olo.prep.${s}` as FloorKey) : PREP_STATUS_LABELS[s] ?? s);
  const headers: FloorKey[] = ["olo.dp.h.die", "olo.dp.h.status", "olo.dp.h.job", "olo.dp.h.order", "olo.dp.h.press", "olo.dp.h.run", "olo.dp.h.preheat"];
  return (
    <div className="space-y-5" lang={lang}>
      <PageHeader title={t("olo.dp.title")} description={t("olo.dp.desc")}
        actions={<div className="flex flex-wrap items-center gap-2"><LiveRefresh name="die-preparation" tables={["die_preparation_events", "olo_task_events"]} /><FloorLanguageToggle lang={lang} />
          <Link href="/production/order-book" className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">{t("olo.dp.orderBook")}</Link></div>} />
      {list ? <>
        <p className="text-sm text-slate-700">{t("olo.dp.control", { prep: t(list.enforcement.die_preparation ? "olo.dp.enforced" : "olo.dp.notEnforced"), preheat: t(list.enforcement.preheat ? "olo.dp.enforced" : "olo.dp.notEnforced") })}{list.standards_configured ? "" : ` ${t("olo.dp.noStandard")}`}</p>
        <nav className="flex flex-wrap gap-2">{FILTERS.map(k => <Link key={k} href={`?status=${k}`} className={`rounded-xl border px-3 py-2 text-sm font-bold ${status === k ? "border-orange bg-orange/10" : "bg-white"}`}>{t(`olo.dp.f.${k}` as FloorKey)}</Link>)}</nav>
        {list.rows.length === 0 ? <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">{t("olo.dp.empty")}</p> : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50"><tr>{headers.map(h => <th key={h} className="px-3 py-2 font-bold">{t(h)}</th>)}</tr></thead>
              <tbody>{list.rows.map(r => <tr key={r.id} className="border-t">
                <td className="px-3 py-2 font-semibold"><Link className="underline" href={`/dies/preparation/${r.id}`}>{r.die_number}</Link>{!r.die_matches_job ? <div className="text-xs font-semibold text-red-800">{t("olo.dp.otherDie")}</div> : null}</td>
                <td className="px-3 py-2">{prepLabel(r.status)}{r.hold_expired ? <div className="text-xs font-semibold text-red-800">{t("olo.dp.holdExceeded")}</div> : null}</td>
                <td className="px-3 py-2">{r.job_number ?? "—"}</td><td className="px-3 py-2">{r.order_number ?? "—"}</td>
                <td className="px-3 py-2">{r.machine_name ?? "—"}{r.queue_rank ? ` · ${r.queue_rank}` : ""}</td><td className="px-3 py-2">{at(r.planned_start_at)}</td><td className="px-3 py-2">{at(r.preheat_scheduled_for)}</td>
              </tr>)}</tbody>
            </table>
          </div>
        )}
        {list.total > list.page_size ? <nav className="flex justify-between text-sm font-semibold">{page > 1 ? <Link href={href(page - 1)}>{t("common.previous")}</Link> : <span />}<span>{t("common.page", { n: page })}</span>{page * list.page_size < list.total ? <Link href={href(page + 1)}>{t("common.next")}</Link> : <span />}</nav> : null}
      </> : <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{!result.success ? result.error : t("olo.dp.loadFailed")}</p>}
    </div>
  );
}
