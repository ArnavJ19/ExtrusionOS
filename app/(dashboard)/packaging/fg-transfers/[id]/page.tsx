import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { FloorLanguageToggle } from "@/components/modules/autopilot-batch9/floor-language";
import { LiveRefresh } from "@/components/modules/intelligence/live";
import { FgCloseForm, FgReceivePanel } from "@/components/modules/orchestration/packaging-flow-forms";
import { getSessionContext } from "@/lib/auth";
import { hasRouteAccess } from "@/lib/auth/route-permissions";
import { packagingFlowAction } from "@/lib/actions/orchestration";
import { floorText, type FloorKey } from "@/lib/i18n/floor";
import { getFloorLanguage } from "@/lib/i18n/floor-server";
import { formatWeight } from "@/lib/utils/format";
import { fgTransferSchema } from "@/lib/workflow/packaging-flow";

const at = (value: string | null) => (value ? new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

// Phase 6: one finished-goods transfer. The receiving person scans each tag in; what does not arrive is closed as missing.
export default async function FgTransferPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, context, lang] = await Promise.all([params, getSessionContext(), getFloorLanguage()]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  if (context.dealerId || !hasRouteAccess("/packaging/fg-transfers", context.role)) redirect("/dashboard");
  const t = floorText(lang);
  const result = await packagingFlowAction({ command: "fg.get", transfer_id: id });
  const parsed = result.success ? fgTransferSchema.safeParse(result.data) : null;
  if (!result.success || !parsed?.success) {
    return <div className="space-y-4" lang={lang}><PageHeader title={t("pkf.fg.title")} backHref="/packaging/fg-transfers" backLabel={t("pkf.fg.back")} />
      <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{!result.success ? result.error : t("pkf.fg.loadFailed")}</p></div>;
  }
  const d = parsed.data;
  const open = d.status === "in_transit";
  return (
    <div className="space-y-5" lang={lang}>
      <PageHeader title={t("pkf.fg.detailTitle", { number: d.transfer_number })} backHref="/packaging/fg-transfers" backLabel={t("pkf.fg.back")}
        description={t("pkf.fg.detailSummary", { bundles: d.bundle_count, kg: formatWeight(d.net_kg), location: `${d.location} (${d.location_code})`, by: d.sent_by_name ?? "—", at: at(d.sent_at) })}
        actions={<div className="flex flex-wrap items-center gap-2"><LiveRefresh name="fg-transfer" tables={["fg_transfers", "fg_transfer_bundles"]} />
          <span className="rounded-xl bg-charcoal px-4 py-3 text-sm font-bold text-white">{t(`pkf.status.${d.status}` as FloorKey)}</span><FloorLanguageToggle lang={lang} /></div>} />
      <p className={`rounded-2xl border p-4 text-sm font-semibold ${d.missing > 0 ? "border-red-200 bg-red-50 text-red-900" : "border-slate-200 bg-white"}`}>{t("pkf.fg.progress", { received: d.received, remaining: d.remaining, missing: d.missing })}</p>
      {d.note ? <p className="text-sm [overflow-wrap:anywhere]">{d.note}</p> : null}
      {d.close_note ? <p className="text-sm [overflow-wrap:anywhere]">{t("pkf.fg.closedNote", { note: d.close_note })}</p> : null}
      {open && d.can_receive ? <FgReceivePanel lang={lang} transferId={d.id} remaining={d.remaining} /> : open ? <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">{t("pkf.fg.notReceiver")}</p> : null}
      {open ? <div className="flex flex-wrap gap-2">{d.can_receive && d.received > 0 ? <FgCloseForm lang={lang} transferId={d.id} mode="close" /> : null}{d.can_cancel ? <FgCloseForm lang={lang} transferId={d.id} mode="cancel" /> : null}</div> : null}
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50"><tr><th scope="col" className="px-3 py-2">{t("pkf.b.h.tag")}</th><th scope="col" className="px-3 py-2">{t("pkf.b.h.order")}</th>
            <th scope="col" className="px-3 py-2">{t("pkf.b.h.net")}</th><th scope="col" className="px-3 py-2">{t("pkf.fg.h.state")}</th></tr></thead>
          <tbody>{d.lines.map(l => (
            <tr key={l.bundle_id} className={`border-t ${l.state === "missing" ? "bg-red-50" : ""}`}>
              <td className="px-3 py-2 font-mono font-semibold"><Link className="underline" href={`/packaging/bundles/${l.bundle_id}`}>{l.bundle_number}</Link></td>
              <td className="px-3 py-2">{l.order_number ?? "—"}<div className="text-xs">{l.job_number ?? "—"} · {l.profile_code ?? "—"}</div></td>
              <td className="px-3 py-2">{formatWeight(l.net_kg)} · {l.pieces} pcs</td>
              <td className="px-3 py-2 font-semibold">{t(`pkf.line.${l.state}` as FloorKey)}{l.received_at ? <div className="text-xs font-normal">{l.received_by_name ?? "—"} · {at(l.received_at)}</div> : null}</td>
            </tr>))}</tbody>
        </table>
      </div>
    </div>
  );
}
