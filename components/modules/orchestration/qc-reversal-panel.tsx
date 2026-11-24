import Link from "next/link";
import { qualityReversalAction } from "@/lib/actions/orchestration";
import { floorText, type FloorLanguage } from "@/lib/i18n/floor";
import { formatWeight } from "@/lib/utils/format";
import { canReverseQc, reversalPreviewSchema } from "@/lib/workflow/quality-reversal";

/** On a QC record: whether it was reversed, came from a reversal, or can be reversed now (and why not). */
export async function QcReversalPanel({ inspectionId, status, reversalId, role, lang = "en" }:
  { inspectionId: string; status: string; reversalId: string | null; role: string; lang?: FloorLanguage }) {
  const t = floorText(lang);
  const box = "rounded-2xl border border-slate-200 bg-white p-4 text-sm";
  // A record written by a reversal says so; its approved part (the quantity kept) can itself be reversed later.
  const origin = reversalId ? <p className={box}>{t("olo.rev.childOf")} <Link className="font-bold underline" href={`/quality/reversals/${reversalId}`}>{t("olo.rev.openReversal")}</Link></p> : null;
  if (status !== "approved" && status !== "reversed") return origin;
  const result = await qualityReversalAction({ command: "preview", inspection_id: inspectionId });
  const parsed = result.success ? reversalPreviewSchema.safeParse(result.data) : null;
  if (!parsed?.success) return <>{origin}{result.success ? null : <p role="alert" className="text-sm font-semibold text-amber-900">{result.error}</p>}</>;
  const p = parsed.data;
  if (p.reversal_id) {
    return <p className={`${box} border-red-200 bg-red-50 text-red-950`}>{t("olo.rev.thisReversed")} <Link className="font-bold underline" href={`/quality/reversals/${p.reversal_id}`}>{t("olo.rev.openReversal")}</Link></p>;
  }
  if (!canReverseQc(role)) return origin;
  return (
    <>{origin}<section className={box}>
      <h2 className="font-bold">{t("olo.rev.panelTitle")}</h2>
      <p className="text-slate-600">{t("olo.rev.panelHelp", { moved: formatWeight(p.moved_on_kg), max: formatWeight(p.max_reversible_kg) })}</p>
      {p.can_reverse ? <Link className="mt-2 inline-flex min-h-11 items-center rounded-xl border border-red-300 bg-white px-4 text-sm font-bold text-red-900" href={`/quality/reversals/new?inspection_id=${inspectionId}`}>{t("olo.rev.start")}</Link>
        : <p className="mt-2 font-semibold">{p.blocker}</p>}
    </section></>
  );
}
