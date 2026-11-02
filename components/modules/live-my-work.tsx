"use client";

import { useRef, useState } from "react";
import { refreshMyWorkAction } from "@/lib/actions/my-work";
import { markWorkRefreshUnavailable, mergeWorkRefresh } from "@/lib/dashboard/work-refresh";
import type { MyWork } from "@/lib/dashboard/my-work";
import { MyWorkToday } from "./my-work-today";

export function LiveMyWork({ initial, scope, name, role }: { initial: MyWork; scope: string; name: string; role: string }) {
  return <WorkWorkspace key={scope} initial={initial} scope={scope} name={name} role={role} />;
}

function WorkWorkspace({ initial, scope, name, role }: { initial: MyWork; scope: string; name: string; role: string }) {
  const [work, setWork] = useState<MyWork | null>(initial);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  async function refresh() {
    if (inFlight.current) return;
    inFlight.current = true; setPending(true); setMessage("");
    try {
      const result = await refreshMyWorkAction();
      if (!result.success || result.scope !== scope) { setWork(null); setMessage("Your workspace session changed or is unavailable. Reload the page to verify access."); return; }
      setWork((previous) => previous ? mergeWorkRefresh(previous, result.work) : result.work);
      setMessage("Queues refreshed. Any unavailable sources are marked individually.");
    } catch {
      setWork((previous) => previous ? markWorkRefreshUnavailable(previous) : null);
      setMessage("Refresh could not be confirmed. Previous entries may have changed; reload before continuing.");
    } finally { inFlight.current = false; setPending(false); }
  }
  return <div className="space-y-3" aria-busy={pending || undefined}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p role="status" className="max-w-2xl text-sm text-neutral-600">{message}</p>
      <button type="button" className="min-h-11 rounded-xl border border-neutral-300 bg-white px-4 text-sm font-bold focus-visible:outline focus-visible:outline-2" disabled={pending} onClick={() => void refresh()}>{pending ? "Refreshing queues..." : "Refresh my work"}</button>
    </div>
    {work ? <MyWorkToday work={work} name={name} role={role} /> : null}
  </div>;
}
