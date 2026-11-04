"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { improvementAction } from "@/lib/actions/improvement";
import { canReadImprovement, improvementLookupSchema } from "@/lib/workflow/improvement";

/**
 * NOV-025: advisory service warnings beside die selection. The production compatibility guard stays
 * authoritative; an unavailable read shows nothing rather than blocking the form.
 */
export function DieServiceNote({ dieId, role }: { dieId: string; role: string }) {
  const [note, setNote] = useState<{ dieId: string; text: string } | null>(null);
  const permitted = canReadImprovement(role, "dies");
  useEffect(() => {
    let live = true;
    if (!permitted || !/^[0-9a-f-]{36}$/i.test(dieId)) return;
    void improvementAction({ command: "lookup", kind: "dies", selected_id: dieId }).then(result => {
      if (!live || !result.success) return;
      const parsed = improvementLookupSchema.safeParse(result.data);
      const match = parsed.success ? parsed.data.find(row => row.value === dieId) : undefined;
      setNote(match && match.context !== "No service warning" ? { dieId, text: match.context } : null);
    }, () => undefined);
    return () => { live = false; };
  }, [dieId, permitted]);
  if (!permitted || !note || note.dieId !== dieId) return null;
  return <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs font-semibold text-amber-950">{note.text}{" "}
    <Link href={`/tasks/improvement/dies/${encodeURIComponent(dieId)}`} className="underline">Die operating history</Link></p>;
}
