"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { orchestrationAction } from "@/lib/actions/orchestration";

/** Acknowledge or start a workflow task. Neither completes it: the records close it when the work is verified. */
export function TaskActions({ taskId, status, acknowledged, labels = { acknowledge: "Acknowledge", start: "Start work" } }: { taskId: string; status: string; acknowledged: boolean; labels?: { acknowledge: string; start: string } }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function run(command: "tasks.acknowledge" | "tasks.start") {
    setBusy(true); setMessage("");
    const result = await orchestrationAction({ command, task_id: taskId });
    setBusy(false);
    if (!result.success) { setMessage(result.error); return; }
    router.refresh();
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {!acknowledged ? <Button variant="secondary" disabled={busy} onClick={() => run("tasks.acknowledge")}>{labels.acknowledge}</Button> : null}
      {status === "open" ? <Button disabled={busy} onClick={() => run("tasks.start")}>{labels.start}</Button> : null}
      {message ? <p role="alert" className="text-xs font-semibold text-red-800">{message}</p> : null}
    </div>
  );
}

export function EvaluateButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function run() {
    setBusy(true); setMessage("");
    const result = await orchestrationAction({ command: "evaluate" });
    setBusy(false);
    if (!result.success) { setMessage(result.error); return; }
    const data = result.data as Record<string, number>;
    setMessage(`Checked: ${data.rank_changes ?? 0} rank changes, ${(data.tasks_created ?? 0) + (data.shortage_tasks ?? 0)} new tasks, ${(data.verified ?? 0) + (data.verified_after_risk ?? 0)} verified, ${data.escalated ?? 0} escalated.`);
    router.refresh();
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" disabled={busy} onClick={run}>{busy ? "Checking…" : "Re-check queue now"}</Button>
      {message ? <p role="status" className="text-xs font-semibold text-slate-700">{message}</p> : null}
    </div>
  );
}
