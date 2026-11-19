"use client";

// FS-51: sign-ins recorded by the server, ten at a time, with failed attempts in the last 24 hours. Five failures in
// 15 minutes lock that account's sign-in for 15 minutes.
import { useState } from "react";
import { Empty, Failure, Loading, Pager, Pill, Section, useB4Read, when } from "./shared";

type Data = { rows: { at: string; event: string; user: string; role: string | null; ip: string | null; user_agent: string | null }[]; total: number; failed_24h: number; page: number };
const LABEL: Record<string, string> = { login_success: "Signed in", login_failed: "Failed sign-in", logout: "Signed out", password_reset: "Password reset", invite_accepted: "Invitation accepted" };

export function LoginHistory() {
  const [page, setPage] = useState(1);
  const { data, error, loading } = useB4Read<Data>("fs_security", "login_history", { page }, [page]);
  return <Section title="Sign-in history" description={data ? `${data.failed_24h} failed sign-in(s) in the last 24 hours. Five failures in 15 minutes lock that account for 15 minutes.` : "Sign-ins and failures recorded by the server."}>
    {loading && !data ? <Loading what="sign-ins" /> : null}
    {error ? <Failure text={error} /> : null}
    {data && data.rows.length === 0 ? <Empty>No sign-in recorded yet.</Empty> : null}
    {data && data.rows.length > 0 ? <ul className="divide-y divide-neutral-200 text-sm">
      {data.rows.map((r, n) => <li key={`${r.at}-${n}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
        <span><Pill value={r.event === "login_failed" ? "rejected" : r.event === "login_success" ? "passed" : "cleared"} label={LABEL[r.event] ?? r.event} /> <span className="font-semibold">{r.user}</span>{r.role ? <span className="text-neutral-500"> ({r.role.replaceAll("_", " ")})</span> : null}</span>
        <span className="text-xs text-neutral-600">{when(r.at)}{r.ip ? ` · ${r.ip}` : ""}{r.user_agent ? ` · ${r.user_agent.slice(0, 60)}` : ""}</span>
      </li>)}
    </ul> : null}
    {data ? <Pager page={data.page} total={data.total} onPage={setPage} /> : null}
  </Section>;
}
