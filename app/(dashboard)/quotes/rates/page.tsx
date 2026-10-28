import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { CostingRateDecision } from "@/components/modules/quotes/costing-rates";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getBusinessDateBoundaries } from "@/lib/utils/business-date";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { BASES, RATE_TYPES, canApproveDraft, canReadRates, canWriteRates, rateListSchema, rateReviewSchema, scopeText } from "@/lib/workflow/costing-rates";

const TABS = { current: "Current", draft: "Drafts awaiting approval", history: "Ended and withdrawn" } as const;
type Tab = keyof typeof TABS;

// UPGRADE_EOS feature 85: approved, draft and past costing rates (10 per page) and rates needing review.
export default async function CostingRatesPage({ searchParams }: { searchParams: Promise<{ status?: string; type?: string; page?: string }> }) {
  const context = await getSessionContext();
  if (context.dealerId || !canReadRates(context.role)) redirect("/quotes");
  const params = await searchParams;
  const status: Tab = params.status && params.status in TABS ? params.status as Tab : "current";
  const rateType = params.type && params.type in RATE_TYPES ? params.type : undefined;
  const page = Math.min(Math.max(Number.parseInt(params.page ?? "1", 10) || 1, 1), 100000);
  const today = getBusinessDateBoundaries().today;
  const supabase = await createClient();
  const [listResult, reviewResult] = await Promise.all([
    supabase.rpc("costing_rate_command", { p_command: "rates.list", p_payload: { status, page, ...(rateType ? { rate_type: rateType } : {}) } }),
    supabase.rpc("costing_rate_command", { p_command: "rates.review", p_payload: {} })
  ]);
  const unavailable = Boolean(listResult.error && ["PGRST202", "42883", "42P01"].includes(listResult.error.code ?? ""));
  const parsed = listResult.error ? null : rateListSchema.safeParse(listResult.data);
  const list = parsed?.success ? parsed.data : null;
  const reviewParsed = reviewResult.error ? null : rateReviewSchema.safeParse(reviewResult.data);
  const review = reviewParsed?.success ? reviewParsed.data : [];
  const totalPages = list ? Math.max(1, Math.ceil(list.total_count / 10)) : 1;
  const href = (patch: Record<string, string | number | undefined>) => {
    const query = new URLSearchParams();
    const next = { status, type: rateType, page: 1, ...patch };
    for (const [key, value] of Object.entries(next)) if (value !== undefined && value !== "" && !(key === "page" && value === 1) && !(key === "status" && value === "current")) query.set(key, String(value));
    const text = query.toString();
    return `/quotes/rates${text ? `?${text}` : ""}`;
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Costing Rates" description="Approved, dated billet, conversion and finishing rates. Quotations are checked against the rate applicable on their quote date, and an approved quotation keeps the rates it was approved with."
        actions={canWriteRates(context.role) ? <Link href="/quotes/rates/new" className="rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-bold text-white">New rate</Link> : null} />

      {review.length ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm">
          <h2 className="font-bold text-amber-950">Needs review ({review.length})</h2>
          <p className="text-xs text-amber-900">Approved rates that have ended, or end within 14 days, with no approved successor. Quotation lines in this scope will show &ldquo;no approved rate&rdquo; once they end.</p>
          <ul className="mt-2 space-y-1">
            {review.slice(0, 10).map((row) => (
              <li key={row.id} className="flex flex-wrap justify-between gap-2"><span className="font-semibold">{scopeText(row)}</span><span>{formatCurrency(row.rate)} {BASES[row.basis]} · {row.expired ? "ended" : "ends"} {formatDate(row.effective_to)}</span></li>
            ))}
          </ul>
        </section>
      ) : null}

      <nav className="flex flex-wrap gap-2 text-sm font-bold" aria-label="Rate status">
        {(Object.keys(TABS) as Tab[]).map((tab) => <Link key={tab} href={href({ status: tab })} aria-current={tab === status ? "page" : undefined} className={`rounded-xl border px-3 py-2 ${tab === status ? "border-neutral-950 bg-neutral-950 text-white" : "border-slate-200 bg-white"}`}>{TABS[tab]}</Link>)}
        <span className="mx-1 self-center text-slate-300">|</span>
        <Link href={href({ type: undefined })} className={`rounded-xl px-3 py-2 ${!rateType ? "underline" : ""}`}>All types</Link>
        {Object.entries(RATE_TYPES).map(([value, text]) => <Link key={value} href={href({ type: value })} className={`rounded-xl px-3 py-2 ${rateType === value ? "underline" : ""}`}>{text}</Link>)}
      </nav>

      {!list ? (
        <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{unavailable ? "Approved costing rates are not available on this database yet. The database upgrade must be applied first." : "Rates could not be loaded. Refresh to retry."}</p>
      ) : !list.rows.length ? <EmptyState title="No rates here" description={status === "current" ? "Add a billet, conversion or finishing rate. Until a rate is approved, quotation lines show no approved rate." : "Nothing in this list."} /> : (
        <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
          {list.rows.map((row) => (
            <li key={row.id} className="space-y-2 p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-bold">{scopeText(row)}</p>
                <p className="font-black">{formatCurrency(row.rate)} <span className="font-semibold text-slate-500">{BASES[row.basis]}</span></p>
              </div>
              <p className="text-xs text-slate-600">
                {formatDate(row.effective_from)} to {row.effective_to ? formatDate(row.effective_to) : "until replaced"}
                {row.status === "approved" ? ` · approved by ${row.approved_by_name ?? "-"}${row.in_effect ? " · in effect today" : row.effective_from > today ? " · starts later" : ""}` : null}
                {row.status === "draft" ? ` · drafted by ${row.created_by_name}` : null}
                {row.status === "withdrawn" ? ` · withdrawn: ${row.withdraw_reason ?? "-"}` : null}
                {row.note ? ` · ${row.note}` : null}
              </p>
              {status === "draft" ? (
                <div className="flex flex-wrap items-center gap-3">
                  <CostingRateDecision rateId={row.id} canApprove={canApproveDraft(context.role, context.userId, row.created_by)} canWithdraw={canWriteRates(context.role)} />
                  {canWriteRates(context.role) ? <Link href={`/quotes/rates/new?edit=${row.id}`} className="text-xs font-bold underline">Edit draft</Link> : null}
                  {row.created_by === context.userId && context.role !== "owner" ? <span className="text-xs text-slate-500">You entered this rate, so another person must approve it.</span> : null}
                </div>
              ) : status === "current" ? <CostingRateDecision rateId={row.id} canApprove={false} canWithdraw={canWriteRates(context.role)} /> : null}
            </li>
          ))}
        </ul>
      )}
      {list && totalPages > 1 ? (
        <nav className="flex items-center justify-between text-sm font-bold" aria-label="Pages">
          {page > 1 ? <Link href={href({ page: page - 1 })} className="rounded-xl border border-slate-200 bg-white px-3 py-2">Previous</Link> : <span />}
          <span className="text-slate-500">Page {page} of {totalPages}</span>
          {page < totalPages ? <Link href={href({ page: page + 1 })} className="rounded-xl border border-slate-200 bg-white px-3 py-2">Next</Link> : <span />}
        </nav>
      ) : null}
    </div>
  );
}
