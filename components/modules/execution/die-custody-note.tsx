"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { executionAction } from "@/lib/actions/execution";
import { canReadExecution, executionLookupSchema } from "@/lib/workflow/execution";

/**
 * NOV-077: a die on an open returnable gate pass is with its custodian, which planners need to see beside
 * die selection. Advisory only: the production compatibility guard stays authoritative, and an unavailable
 * read shows nothing rather than blocking the form.
 */
export function DieCustodyNote({ dieId, role }: { dieId: string; role: string }) {
  const [note, setNote] = useState<{ dieId: string; text: string } | null>(null);
  const permitted = canReadExecution(role, "gate_passes");
  useEffect(() => {
    let live = true;
    if (!permitted || !/^[0-9a-f-]{36}$/i.test(dieId)) return;
    void executionAction({ command: "lookup", kind: "dies", selected_id: dieId }).then(result => {
      if (!live || !result.success) return;
      const parsed = executionLookupSchema.safeParse(result.data);
      const match = parsed.success ? parsed.data.find(row => row.value === dieId) : undefined;
      setNote(match && /on pass /.test(match.context) ? { dieId, text: `This die is out on a returnable gate pass (${match.context.split("on pass ")[1]}). Confirm it is back before planning work on it.` } : null);
    }, () => undefined);
    return () => { live = false; };
  }, [dieId, permitted]);
  if (!permitted || !note || note.dieId !== dieId) return null;
  return <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs font-semibold text-amber-950">{note.text}{" "}
    <Link href="/tasks/execution/database?view=gate_passes" className="underline">Gate passes</Link></p>;
}
