import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { FloorLanguageToggle } from "@/components/modules/autopilot-batch9/floor-language";
import { getSessionContext } from "@/lib/auth";
import { hasRouteAccess } from "@/lib/auth/route-permissions";
import { packagingFlowAction } from "@/lib/actions/orchestration";
import { floorText, isFloorKey, type FloorKey } from "@/lib/i18n/floor";
import { getFloorLanguage } from "@/lib/i18n/floor-server";
import { formatWeight } from "@/lib/utils/format";
import { bundleLookupSchema } from "@/lib/workflow/packaging-flow";

const at = (value: string | null | undefined) => (value ? new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const words = (s: string | null | undefined) => (s ? s.replace(/_/g, " ") : "—");
function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-4"><h2 className="text-lg font-bold">{title}</h2><div className="mt-2 space-y-1 text-sm">{children}</div></section>;
}

// Phase 6: the trace of one bundle, from billet to invoice. Every step is read from its own record; a step without a
// record is listed under missing records, never filled in.
export default async function BundleTracePage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, context, lang] = await Promise.all([params, getSessionContext(), getFloorLanguage()]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  if (context.dealerId || !hasRouteAccess("/packaging/bundles", context.role)) redirect("/dashboard");
  const t = floorText(lang);
  const result = await packagingFlowAction({ command: "bundle.trace", bundle_id: id });
  const parsed = result.success ? bundleLookupSchema.safeParse(result.data) : null;
  if (result.success && parsed?.success && !parsed.data.found) notFound();
  if (!result.success || !parsed?.success || !parsed.data.found) {
    return <div className="space-y-4" lang={lang}><PageHeader title={t("pkf.b.title")} backHref="/packaging/bundles" backLabel={t("pkf.t.back")} />
      <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{!result.success ? result.error : t("pkf.t.loadFailed")}</p></div>;
  }
  const d = parsed.data;
  const b = d.bundle;
  const state = (s: string) => (isFloorKey(`pkf.state.${s}`) ? t(`pkf.state.${s}` as FloorKey) : words(s));
  const line = (s: string) => (isFloorKey(`pkf.line.${s}`) ? t(`pkf.line.${s}` as FloorKey) : words(s));
  const route = d.route ? (isFloorKey(`fqc.route.${d.route.state}`) ? t(`fqc.route.${d.route.state}` as FloorKey) : words(d.route.state)) : null;
  return (
    <div className="space-y-4" lang={lang}>
      <PageHeader title={t("pkf.t.title", { tag: b.bundle_number })} backHref="/packaging/bundles" backLabel={t("pkf.t.back")}
        description={t("pkf.t.summary", { pieces: b.pieces, length: b.net_length_m, gross: formatWeight(b.gross_kg), tare: formatWeight(b.tare_kg), net: formatWeight(b.net_kg), at: at(b.recorded_at), by: b.recorded_by })}
        actions={<div className="flex flex-wrap items-center gap-2"><span className="rounded-xl bg-charcoal px-4 py-3 text-sm font-bold text-white">{state(b.state)}</span><FloorLanguageToggle lang={lang} /></div>} />
      {d.hold && !d.dispatch ? <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-900">{t("pkf.t.hold", { number: d.hold })}</p> : null}
      <Section title={t("pkf.t.gaps")}>
        {d.gaps.length === 0 ? <p className="text-emerald-900">{t("pkf.t.noGaps")}</p> : <ul className="list-disc space-y-1 pl-5 text-amber-900">{d.gaps.map(g => <li key={g}>{g}</li>)}</ul>}
      </Section>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t("pkf.t.order")}>
          <p><Link className="font-semibold underline" href={`/orders/${d.order.id}/lifecycle`}>{d.order.order_number ?? "—"}</Link> · {d.order.customer ?? "—"} · {words(d.order.stage)}</p>
          {d.profile ? <p>{t("pkf.t.profile")}: {d.profile.profile_code ?? "—"} · {d.profile.profile_name ?? ""} · {d.profile.alloy ?? "—"} {d.profile.temper ?? ""}</p> : null}
        </Section>
        <Section title={t("pkf.t.source")}>
          {d.stock ? <p>{t("pkf.t.stock", { bundle: d.stock.bundle_number ?? "—", origin: words(d.stock.origin_type), qc: words(d.stock.qc_status) })}</p> : null}
          {d.job ? <p><Link className="underline" href={`/production/${d.job.id}`}>{t("pkf.t.job", { job: d.job.job_number ?? "—", status: words(d.job.status), press: d.job.machine_name ?? "—", die: d.job.die_number ?? "—", at: at(d.job.completed_at) })}</Link></p>
            : !d.stock ? <p>{t("pkf.t.none")}</p> : null}
          {route ? <p>{t("pkf.t.route", { route })}{d.route?.detail ? ` — ${d.route.detail}` : ""}</p> : null}
        </Section>
        <Section title={t("pkf.t.metal")}>
          {d.billets.length === 0 ? <p>{t("pkf.t.noBillets")}</p> : <ul className="space-y-1">{d.billets.map(x => <li key={x.billet_code}>{x.billet_code} · {x.alloy ?? "—"} {x.temper ?? ""} · {formatWeight(x.weight_kg ?? 0)} · {words(x.source_type)} {x.batch_number ?? ""}{x.heat_number ? ` · heat ${x.heat_number}` : ""}</li>)}</ul>}
        </Section>
        <Section title={t("pkf.t.qc")}>
          {d.qc.length === 0 ? <p>{t("pkf.t.none")}</p> : <ul className="space-y-1">{d.qc.map(x => <li key={x.id}><Link className="underline" href={`/quality/${x.id}`}>{x.batch_number ?? "—"}</Link> · {words(x.status)} · {formatWeight(x.quantity_kg)} · {at(x.inspected_at)} · {x.inspector ?? "—"}</li>)}</ul>}
          {d.hold ? <p className="font-semibold text-red-900">{t("pkf.t.hold", { number: d.hold })}</p> : null}
        </Section>
        {d.ageing.length || d.final_qc.length ? <Section title={t("pkf.t.ageing")}>
          <ul className="space-y-1">{d.ageing.map(x => <li key={x.batch_number}>{x.batch_number} · {x.recipe} · {words(x.status)} · {formatWeight(x.loaded_kg)}</li>)}</ul>
          {d.final_qc.length ? <><p className="pt-2 font-semibold">{t("pkf.t.finalQc")}</p><ul className="space-y-1">{d.final_qc.map(x => <li key={x.record_number}>{x.record_number} · +{formatWeight(x.accepted_kg)} / −{formatWeight(x.rejected_kg)} · {x.method}{x.certificate_reference ? ` · ${x.certificate_reference}` : ""} · {at(x.recorded_at)}</li>)}</ul></> : null}
        </Section> : null}
        <Section title={t("pkf.t.packaging")}>
          {d.packaging.length ? <ul className="space-y-1">{d.packaging.map(x => <li key={x.packaging_number}>{x.packaging_number} · {words(x.status)} · {formatWeight(x.weight_kg)}</li>)}</ul> : null}
          <p>{d.labels && d.labels.prints > 0 ? t("pkf.t.labels", { n: d.labels.prints, at: at(d.labels.last_printed_at) }) : t("pkf.t.noLabel")}</p>
        </Section>
        <Section title={t("pkf.t.custody")}>
          {d.custody.length === 0 ? <p>{t("pkf.t.noCustody")}</p> : <ul className="space-y-1">{d.custody.map(x => <li key={x.transfer_id}><Link className="underline" href={`/packaging/fg-transfers/${x.transfer_id}`}>{x.transfer_number}</Link> · {x.location} · {line(x.state)} · {at(x.received_at ?? x.sent_at)}{x.received_by ? ` · ${x.received_by}` : ""}</li>)}</ul>}
        </Section>
        <Section title={t("pkf.t.loading")}>
          {d.loading.length === 0 ? <p>{t("pkf.t.none")}</p> : <ul className="space-y-1">{d.loading.map(x => <li key={x.scanned_at}>{x.vehicle_number ?? "—"} · {at(x.scanned_at)} · {words(x.session_status)}{x.removed ? ` · ${t("pkf.t.removed")}` : ""}</li>)}</ul>}
        </Section>
        <Section title={t("pkf.t.dispatch")}>
          {d.dispatch ? <><p><Link className="font-semibold underline" href={`/dispatches/${d.dispatch.id}`}>{d.dispatch.dispatch_number ?? "—"}</Link> · {words(d.dispatch.delivery_status)} · {d.dispatch.vehicle_number ?? "—"} · {d.dispatch.transporter_name ?? "—"}</p>
            <p>{t("pkf.t.dispatchLine", { lr: d.dispatch.lr_number ?? "—", eway: d.dispatch.eway_bill_number ?? "—", left: at(d.dispatch.left_at), delivered: at(d.dispatch.delivered_at) })}</p></> : <p>{t("pkf.t.notDispatched")}</p>}
        </Section>
        <Section title={t("pkf.t.invoice")}>
          {d.invoices.length === 0 ? <p>{t("pkf.t.noInvoice")}</p> : <ul className="space-y-1">{d.invoices.map(x => <li key={x.id}><Link className="underline" href={`/invoices/${x.id}`}>{x.invoice_number ?? "draft"}</Link> · {words(x.status)} · {x.invoice_date ?? "—"}</li>)}</ul>}
        </Section>
      </div>
    </div>
  );
}
