"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { instantFindAction } from "@/lib/actions/instant-search";
import { cleanFindQuery, type FindResponse } from "@/lib/workflow/instant-search";
import { labelize } from "@/types/app";

export function InstantFind({ initialQuery = "" }: { initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [result, setResult] = useState<FindResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [retry, setRetry] = useState(0);
  const version = useRef(0);
  useEffect(() => {
    const current = ++version.current;
    if (query.length > 80 || cleanFindQuery(query).length < 2) return;
    const timer = setTimeout(async () => {
      setPending(true);
      try { const response = await instantFindAction(query); if (version.current === current) setResult(response); }
      catch { if (version.current === current) setResult({ query: "", items: [], unavailable: [], error: "Search is unavailable. Retry the lookup." }); }
      finally { if (version.current === current) setPending(false); }
    }, 250);
    return () => { version.current++; clearTimeout(timer); };
  }, [query, retry]);
  const valid = query.length <= 80 && cleanFindQuery(query).length >= 2;
  const current = valid && result?.query === cleanFindQuery(query) ? result : null;
  return <div className="space-y-4"><form className="flex flex-col gap-3 sm:flex-row" action="/search"><label className="flex-1"><span className="form-label">Find a record and choose an action</span><input name="q" aria-label="Find records" maxLength={80} autoComplete="off" className="form-input mt-1" placeholder="Order number, profile code, customer, die, or vehicle" value={query} onChange={(event) => { setQuery(event.target.value); setResult(null); setPending(false); }} /></label><button className="self-end rounded-xl bg-neutral-950 px-5 py-3 text-sm font-bold text-white" type="submit">Show full search results</button></form>
    <div aria-live="polite" role="status" className="text-sm text-neutral-600">{!valid ? "Type at least 2 searchable characters. Results update while you type." : pending || (!current && !result?.error) ? "Finding permitted records..." : current ? `${current.items.length} quick matches. Showing at most 6 per record type.` : result?.error}</div>
    {result?.error && valid ? <button type="button" className="text-sm font-bold underline" onClick={() => setRetry((value) => value + 1)}>Retry instant search</button> : null}
    {current?.unavailable.length ? <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Some records could not be checked: {current.unavailable.map(labelize).join(", ")}. These are not verified empty results. <button type="button" className="font-bold underline" onClick={() => setRetry((value) => value + 1)}>Retry lookup</button></p> : null}
    {current ? <ul aria-label="Instant record matches" className="grid gap-3 lg:grid-cols-2">{current.items.map((item) => <li key={`${item.resource}:${item.id}`} className="min-w-0 rounded-2xl border border-neutral-200 bg-white p-4"><p className="text-xs font-bold uppercase tracking-wide text-neutral-500">{labelize(item.resource)} / {labelize(item.status)}</p><Link href={item.href} className="mt-1 block break-words text-base font-bold text-neutral-950 underline decoration-neutral-200 underline-offset-4">{item.title}</Link><p className="mt-1 break-words text-sm text-neutral-600">{item.detail}</p><div className="mt-3 flex flex-wrap gap-3 text-sm font-bold"><Link href={item.href}>Open {labelize(item.resource).toLowerCase().replace(/s$/, "")}</Link>{item.action ? <Link className="text-orange" href={item.action.href}>{item.action.label}</Link> : null}</div></li>)}</ul> : null}
  </div>;
}
