"use client";

// Accounts queue for metal bought from outside: completed scrap receipts and external aluminium sources recorded on
// the floor without money. Accounts attach the bill and enter the vendor, rate, GST, freight and discount; the database
// posts the expense for approval from those values.
import { useState } from "react";
import Link from "next/link";
import { FILE_KINDS, FINANCE_FILE_KINDS, type FileKind, type ReceiptFile } from "@/lib/foundry/scrap-receiving";
import { fmtWhen } from "@/lib/order-to-cash/commands";
import { Empty, Failure, Loading, Pager, Pill, Section, inputClass, secondaryClass, useApRead } from "../../order-to-cash/ui";
import { BillForm, FileAttach, FileList, kgText, labelClass, type FinanceValues } from "./shared";

type QueueRow = { kind: "scrap_receipt" | "external_source"; id: string; number: string; at_time: string; kg: number; rejected_kg: number | null; material: string | null; alloy: string | null;
  status: string; vendor: string | null; invoice_number: string | null };
type Source = FinanceValues & { id: string; source_number: string; item_type: string; alloy: string | null; weight_kg: number; quantity: number | null; source_origin: string;
  received_date: string; weighbridge_reference: string | null; finance_status: string | null; files: ReceiptFile[] };

export function MetalFinanceQueue({ companyId }: { companyId: string }) {
  const [status, setStatus] = useState<"pending" | "completed">("pending"); const [page, setPage] = useState(1); const [open, setOpen] = useState<string | null>(null);
  const queue = useApRead<{ rows: QueueRow[]; total: number }>("ap_scrap_receipt", "finance_queue", { page, status }, [page, status]);
  return <Section title={status === "pending" ? "Bills to record" : "Bills recorded"} description="Scrap receipts and external aluminium received by the foundry. Ten per page, newest first.">
    <div className="flex gap-1" role="tablist" aria-label="Bill status">{(["pending", "completed"] as const).map((key) => <button key={key} type="button" role="tab" aria-selected={status === key}
      className={`min-h-9 rounded-full border px-3 text-xs font-bold ${status === key ? "border-neutral-950 bg-neutral-950 text-white" : "bg-white"}`} onClick={() => { setStatus(key); setPage(1); setOpen(null); }}>{key === "pending" ? "Bill pending" : "Recorded"}</button>)}</div>
    {queue.loading && !queue.data ? <Loading what="the bill queue" /> : queue.error ? <Failure text={queue.error} /> : !queue.data?.rows.length ? <Empty>{status === "pending" ? "No bill is waiting." : "No bill recorded yet."}</Empty> : <>
      <ul className="space-y-2">{queue.data.rows.map((row) => <li key={`${row.kind}:${row.id}`} className="space-y-3 rounded-xl border p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div><p className="font-bold">{row.number} · {row.material ?? "—"}{row.alloy ? ` · ${row.alloy}` : ""}</p>
            <p className="text-xs text-neutral-500">{row.kind === "scrap_receipt" ? "Scrap receipt" : "External aluminium source"} · {fmtWhen(row.at_time)}{row.vendor ? ` · ${row.vendor}` : ""}{row.invoice_number ? ` · bill ${row.invoice_number}` : ""}</p>
            <p className="text-sm">{kgText(row.kg)}{row.rejected_kg ? ` accepted · ${kgText(row.rejected_kg)} not of quality` : ""}</p></div>
          <div className="flex items-center gap-2"><Pill value={row.status === "completed" ? "posted" : "held"} label={row.status === "completed" ? "Recorded" : "Bill pending"} />
            {row.kind === "scrap_receipt" ? <Link className={`${secondaryClass} inline-flex items-center`} href={`/foundry/scrap/receipts/${row.id}`}>Open receipt</Link>
              : <button type="button" className={secondaryClass} aria-expanded={open === row.id} onClick={() => setOpen(open === row.id ? null : row.id)}>{open === row.id ? "Close" : "Record bill"}</button>}</div>
        </div>
        {row.kind === "external_source" && open === row.id ? <SourceBill companyId={companyId} id={row.id} onSaved={queue.reload} /> : null}
      </li>)}</ul>
      <Pager page={page} total={queue.data.total} onPage={setPage} />
    </>}
  </Section>;
}

function SourceBill({ companyId, id, onSaved }: { companyId: string; id: string; onSaved: () => void }) {
  const source = useApRead<Source>("ap_scrap_receipt", "source_get", { id }, []);
  const [kind, setKind] = useState<FileKind>("bill");
  const s = source.data;
  if (source.loading && !s) return <Loading what="the source" />;
  if (source.error || !s) return <Failure text={source.error ?? "The source could not be loaded."} />;
  return <div className="space-y-3 rounded-xl bg-neutral-50 p-3">
    <p className="text-sm">{s.item_type.replaceAll("_", " ")} · {kgText(s.weight_kg)}{s.quantity ? ` · ${s.quantity} pcs` : ""} · from {s.source_origin}{s.weighbridge_reference ? ` · slip ${s.weighbridge_reference}` : ""}</p>
    <div className="grid gap-2 sm:grid-cols-[200px_1fr]">
      <label className={labelClass}>Document<select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as FileKind)}>{FINANCE_FILE_KINDS.map((k) => <option key={k} value={k}>{FILE_KINDS[k]}</option>)}</select></label>
      <FileAttach key={kind} companyId={companyId} parent={s.id} parentKey="external_source_id" kind={kind} label={`Attach the ${FILE_KINDS[kind].toLowerCase()}`} onAdded={source.reload} />
    </div>
    <FileList files={s.files} kinds={FINANCE_FILE_KINDS} empty="No bill attached yet." />
    <BillForm command="source_finance_save" idKey="source_id" id={s.id} kg={Number(s.weight_kg)} initial={s} hasBill={s.files.some((f) => f.kind === "bill")} onSaved={() => { source.reload(); onSaved(); }} />
  </div>;
}
