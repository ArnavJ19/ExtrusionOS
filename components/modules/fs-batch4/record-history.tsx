"use client";

// FS-79: the History tab on a record. Who changed what, from what to what, and when — field changes, order stage moves
// and approval decisions, ten at a time, newest first. Read from the existing audit tables by public.fs_history, which
// checks the record belongs to the company and the role may open it, and hides cost and margin from roles that may not
// see them.
import { useState } from "react";
import { History } from "lucide-react";
import type { HistoryEntity } from "@/lib/fs-batch4/commands";
import { Empty, Failure, Loading, Pager, Section, fieldLabel, useB4Read, valueText, when } from "./shared";

type Change = { field: string; old: unknown; new: unknown; hidden: boolean };
type Row = { at: string; actor: string; role: string | null; kind: "created" | "changed" | "deleted" | "stage" | "approval"; changes: Change[]; note: string | null; ref: string };
type Data = { rows: Row[]; total: number; page: number; sees_cost: boolean };

const KIND: Record<Row["kind"], string> = { created: "Created", changed: "Changed", deleted: "Deleted", stage: "Stage moved", approval: "Approval decision" };

export function RecordHistory({ entityType, entityId }: { entityType: HistoryEntity; entityId: string }) {
  const [page, setPage] = useState(1);
  const { data, error, loading } = useB4Read<Data>("fs_history", "record", { entity_type: entityType, entity_id: entityId, page }, [page]);
  return <Section id="history" title="History" description="Every change to this record: who, when, which field, and the value before and after.">
    {loading && !data ? <Loading what="history" /> : null}
    {error ? <Failure text={error} /> : null}
    {data && data.rows.length === 0 ? <Empty>No recorded changes yet. Changes made from now on appear here.</Empty> : null}
    {data && data.rows.length > 0 ? <ol className="space-y-3">
      {data.rows.map(row => <li key={row.ref} className="rounded-xl border border-neutral-200 p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <p className="font-bold"><History aria-hidden className="mr-1 inline" size={14} />{KIND[row.kind]} by {row.actor}{row.role ? <span className="font-normal text-neutral-500"> ({row.role.replaceAll("_", " ")})</span> : null}</p>
          <time className="text-xs text-neutral-600" dateTime={row.at}>{when(row.at)}</time>
        </div>
        {row.kind !== "created" && row.kind !== "deleted" && row.changes.length > 0 ? <ul className="mt-2 space-y-1 text-sm">
          {row.changes.slice(0, 12).map(c => <li key={c.field} className="break-words">
            <span className="font-semibold">{fieldLabel(c.field)}</span>{": "}
            {c.hidden ? <span className="text-neutral-500">changed (hidden for your role)</span>
              : row.kind === "stage" || row.kind === "approval" ? <span>{valueText(c.new)}</span>
                : <><span className="text-neutral-500 line-through decoration-neutral-400">{valueText(c.old)}</span> → <span>{valueText(c.new)}</span></>}
          </li>)}
          {row.changes.length > 12 ? <li className="text-xs text-neutral-500">and {row.changes.length - 12} more field(s)</li> : null}
        </ul> : null}
        {row.note ? <p className="mt-1 text-sm text-neutral-700">“{row.note}”</p> : null}
      </li>)}
    </ol> : null}
    {data ? <Pager page={data.page} total={data.total} onPage={setPage} /> : null}
  </Section>;
}
