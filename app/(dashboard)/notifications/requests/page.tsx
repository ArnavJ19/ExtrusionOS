import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { RequestRow } from "@/components/modules/notifications/record-follow";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { requestListSchema } from "@/lib/workflow/subscriptions";

// UPGRADE_EOS feature 48: requests for action, asked of me or by me, open or resolved (10 per page).
export default async function ActionRequestsPage({ searchParams }: { searchParams: Promise<{ box?: string; state?: string; page?: string }> }) {
  const context = await getSessionContext();
  if (context.dealerId) redirect("/notifications");
  const params = await searchParams;
  const box = params.box === "sent" ? "sent" : "inbox";
  const state = params.state === "resolved" ? "resolved" : "open";
  const page = Math.min(Math.max(Number.parseInt(params.page ?? "1", 10) || 1, 1), 100000);
  const supabase = await createClient();
  const result = await supabase.rpc("subscription_command", { p_command: "request.list", p_payload: { box, state, page } });
  const unavailable = Boolean(result.error && ["PGRST202", "42883", "42P01"].includes(result.error.code ?? ""));
  const parsed = result.error ? null : requestListSchema.safeParse(result.data);
  const list = parsed?.success ? parsed.data : null;
  const totalPages = list ? Math.max(1, Math.ceil(list.total_count / 10)) : 1;
  const href = (patch: { box?: string; state?: string; page?: number }) => {
    const query = new URLSearchParams();
    const next = { box, state, page: 1, ...patch };
    if (next.box !== "inbox") query.set("box", next.box);
    if (next.state !== "open") query.set("state", next.state);
    if (next.page > 1) query.set("page", String(next.page));
    return `/notifications/requests${query.size ? `?${query}` : ""}`;
  };
  const tab = (active: boolean) => `rounded-xl border px-3 py-2 ${active ? "border-neutral-950 bg-neutral-950 text-white" : "border-slate-200 bg-white"}`;

  return (
    <div className="space-y-5">
      <PageHeader title="Action Requests" description="Requests for action, kept apart from information updates. A request is checked against its record and closes by itself once the work is done, so reminders stop."
        actions={<Link href="/notifications/following" className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold">Following</Link>} />
      <nav className="flex flex-wrap gap-2 text-sm font-bold" aria-label="Request views">
        <Link href={href({ box: "inbox" })} className={tab(box === "inbox")}>Asked of me</Link>
        <Link href={href({ box: "sent" })} className={tab(box === "sent")}>Asked by me</Link>
        <span className="mx-1 self-center text-slate-300">|</span>
        <Link href={href({ state: "open" })} className={tab(state === "open")}>Open</Link>
        <Link href={href({ state: "resolved" })} className={tab(state === "resolved")}>Resolved</Link>
      </nav>
      {!list ? (
        <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{unavailable ? "Action requests are not available on this database yet. The database upgrade must be applied first." : "Requests could not be loaded. Refresh to retry."}</p>
      ) : !list.rows.length ? <EmptyState title="Nothing here" description={box === "inbox" ? "No one is waiting on you." : "Ask a colleague to act from any order, quotation, dispatch, inspection or invoice."} /> : (
        <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">{list.rows.map((request) => <RequestRow key={request.id} request={request} box={box} />)}</ul>
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
