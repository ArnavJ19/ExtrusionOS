import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { DigestCard, DigestNowButton, PreferencesForm } from "@/components/modules/notifications/record-follow";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils/format";
import { CATEGORY_LABELS, FOLLOW_TYPES, digestListSchema, followListSchema, preferencesSchema, recordHref } from "@/lib/workflow/subscriptions";

const UNAVAILABLE = ["PGRST202", "42883", "42P01"];

// UPGRADE_EOS feature 48: records I follow (10 per page), delivery preferences and grouped summaries.
export default async function FollowingPage({ searchParams }: { searchParams: Promise<{ page?: string; digests?: string }> }) {
  const context = await getSessionContext();
  if (context.dealerId) redirect("/notifications");
  const params = await searchParams;
  const page = Math.min(Math.max(Number.parseInt(params.page ?? "1", 10) || 1, 1), 100000);
  const digestPage = Math.min(Math.max(Number.parseInt(params.digests ?? "1", 10) || 1, 1), 100000);
  const supabase = await createClient();
  const [followsResult, prefsResult, digestsResult] = await Promise.all([
    supabase.rpc("subscription_command", { p_command: "follow.list", p_payload: { page } }),
    supabase.rpc("subscription_command", { p_command: "prefs.get", p_payload: {} }),
    supabase.rpc("subscription_command", { p_command: "digest.list", p_payload: { page: digestPage } })
  ]);
  const unavailable = Boolean(followsResult.error && UNAVAILABLE.includes(followsResult.error.code ?? ""));
  const follows = followsResult.error ? null : followListSchema.safeParse(followsResult.data);
  const prefs = prefsResult.error ? null : preferencesSchema.safeParse(prefsResult.data);
  const digests = digestsResult.error ? null : digestListSchema.safeParse(digestsResult.data);
  const followPages = follows?.success ? Math.max(1, Math.ceil(follows.data.total_count / 10)) : 1;
  const digestPages = digests?.success ? Math.max(1, Math.ceil(digests.data.total_count / 10)) : 1;
  const href = (next: { page?: number; digests?: number }) => {
    const query = new URLSearchParams();
    const p = next.page ?? page; const d = next.digests ?? digestPage;
    if (p > 1) query.set("page", String(p));
    if (d > 1) query.set("digests", String(d));
    return `/notifications/following${query.size ? `?${query}` : ""}`;
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Following" description="Records you follow and how their updates reach you. Repeated changes to a record are grouped into one line; your own changes are never sent back to you."
        actions={<Link href="/notifications/requests" className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold">Action requests</Link>} />
      {!follows?.success || !prefs?.success ? (
        <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{unavailable ? "Following records is not available on this database yet. The database upgrade must be applied first." : "Your subscriptions could not be loaded. Refresh to retry."}</p>
      ) : (
        <>
          <PreferencesForm initial={prefs.data} />
          <section className="space-y-2">
            <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">Records you follow ({follows.data.total_count})</h2>
            {!follows.data.rows.length ? <EmptyState title="Not following anything yet" description="Open an order, quotation, dispatch, inspection, production job or invoice and choose Follow updates." /> : (
              <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
                {follows.data.rows.map((row) => (
                  <li key={`${row.entity_type}:${row.entity_id}`} className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
                    <div>
                      {row.can_open ? <Link href={recordHref(row.entity_type, row.entity_id)} className="font-bold underline-offset-2 hover:underline">{row.label}</Link> : <span className="font-bold">{row.label}</span>}
                      <p className="text-xs text-slate-500">{FOLLOW_TYPES[row.entity_type].label} · {row.state ? row.state.replace(/_/g, " ") : "no longer available"} · {row.categories.map((c) => CATEGORY_LABELS[c]).join(", ")}</p>
                    </div>
                    <span className="text-xs text-slate-500">since {formatDate(row.created_at)}{row.can_open ? "" : " · your role can no longer open it, so nothing is sent"}</span>
                  </li>
                ))}
              </ul>
            )}
            {followPages > 1 ? (
              <nav className="flex items-center justify-between text-sm font-bold" aria-label="Followed record pages">
                {page > 1 ? <Link href={href({ page: page - 1 })} className="rounded-xl border border-slate-200 bg-white px-3 py-2">Previous</Link> : <span />}
                <span className="text-slate-500">Page {page} of {followPages}</span>
                {page < followPages ? <Link href={href({ page: page + 1 })} className="rounded-xl border border-slate-200 bg-white px-3 py-2">Next</Link> : <span />}
              </nav>
            ) : null}
          </section>
          <section className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">Recent summaries</h2>
              <DigestNowButton />
            </div>
            {!digests?.success ? <p className="text-sm text-amber-900">Summaries could not be loaded.</p> : !digests.data.rows.length ? <p className="text-sm text-slate-600">No summaries yet.</p> : (
              <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">{digests.data.rows.map((digest) => <DigestCard key={digest.id} digest={digest} />)}</ul>
            )}
            {digests?.success && digestPages > 1 ? (
              <nav className="flex items-center justify-between text-sm font-bold" aria-label="Summary pages">
                {digestPage > 1 ? <Link href={href({ digests: digestPage - 1 })} className="rounded-xl border border-slate-200 bg-white px-3 py-2">Previous</Link> : <span />}
                <span className="text-slate-500">Page {digestPage} of {digestPages}</span>
                {digestPage < digestPages ? <Link href={href({ digests: digestPage + 1 })} className="rounded-xl border border-slate-200 bg-white px-3 py-2">Next</Link> : <span />}
              </nav>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
