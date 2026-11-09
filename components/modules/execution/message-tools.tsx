"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * NOV-019: copy, download and print are client-side outcomes. They do not claim that anything was sent;
 * the "how it was used" action records them through the reviewed protocol.
 */
export function MessageTools({ id, details }: { id: string; details: Record<string, unknown> }) {
  const body = String(details.message_body ?? "");
  const [feedback, setFeedback] = useState("");
  async function copy() {
    try { await navigator.clipboard.writeText(body); setFeedback("Text copied to the clipboard. Record how you used it below."); }
    catch { setFeedback("This browser blocked copying. Select the text and copy it by hand."); }
  }
  function download() {
    try {
      const url = URL.createObjectURL(new Blob([body], { type: "text/plain;charset=utf-8" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `message-${id.slice(0, 8)}.txt`; anchor.click(); URL.revokeObjectURL(url);
      setFeedback("Text file downloaded. Record how you used it below.");
    } catch { setFeedback("The file could not be created. Copy the text instead."); }
  }
  return <section className="min-w-0 space-y-3 rounded-2xl border border-slate-200 bg-white p-4 print:border-0">
    <h2 className="font-bold">Prepared message</h2>
    <dl className="grid gap-3 text-sm sm:grid-cols-2">
      <div><dt className="text-xs font-bold text-slate-500">Recipient</dt><dd>{String(details.recipient_name ?? "")}</dd></div>
      <div><dt className="text-xs font-bold text-slate-500">Mobile number ({String(details.recipient_source ?? "").replaceAll("_", " ")})</dt><dd>{String(details.recipient_phone ?? "")}</dd></div>
      <div><dt className="text-xs font-bold text-slate-500">Document</dt><dd>{details.document_href ? <Link href={String(details.document_href)} className="font-semibold underline">{String(details.document_label ?? "Open the document")}</Link> : "None attached"}</dd></div>
      <div><dt className="text-xs font-bold text-slate-500">State</dt><dd>{String(details.message_state ?? "").replaceAll("_", " ")}</dd></div>
    </dl>
    <pre aria-label="Message text" className="whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-3 font-sans text-sm text-slate-900">{body}</pre>
    {details.stale ? <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">The recipient or the record changed after this message was prepared. Prepare it again before using it.</p> : null}
    <div className="flex flex-wrap gap-2 print:hidden">
      <Button type="button" variant="secondary" onClick={() => void copy()}>Copy text</Button>
      <Button type="button" variant="secondary" onClick={download}>Download text file</Button>
      <Button type="button" variant="secondary" onClick={() => window.print()}>Print</Button>
    </div>
    {feedback ? <p role="status" className="text-sm text-slate-700">{feedback}</p> : null}
    <p className="text-xs text-slate-600">{String(details.delivery_note ?? "")}</p>
  </section>;
}
