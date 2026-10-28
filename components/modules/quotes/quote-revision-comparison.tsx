import { formatCurrency, formatDate } from "@/lib/utils/format";
import { isIssuedStatus, type FieldChange, type FieldUnit, type VersionSide } from "@/lib/workflow/quote-revision-compare";
import type { QuoteComparisonState } from "@/lib/workflow/quote-revision-loader";

type Names = Extract<QuoteComparisonState, { status: "ready" }>["names"];

const NOT_RECORDED = "Not recorded";
const numberText = (value: number, digits: number) => value.toLocaleString("en-IN", { maximumFractionDigits: digits });

export function formatChangeValue(value: unknown, unit: FieldUnit, key: string, names: Names) {
  if (value === null || value === undefined) return NOT_RECORDED;
  if (key === "profile_id") return names.profiles[String(value)] || "Unavailable profile";
  if (key === "die_id") return names.dies[String(value)] || "Unavailable die";
  if (key === "customer_id") return names.customers[String(value)] || "Unavailable customer";
  if (typeof value !== "number") return unit === "date" ? formatDate(String(value)) : String(value).replace(/_/g, " ");
  switch (unit) {
    case "pcs": return `${numberText(value, 0)} pcs`;
    case "m": return `${numberText(value, 3)} m`;
    case "kg": return `${numberText(value, 3)} kg`;
    case "kg/m": return `${numberText(value, 6)} kg/m`;
    case "inr": return formatCurrency(value);
    case "inr/kg": return `${formatCurrency(value)}/kg`;
    case "inr/m": return `${formatCurrency(value)}/m`;
    case "percent": return `${numberText(value, 2)}%`;
    default: return String(value);
  }
}

function deltaText(change: FieldChange) {
  if (change.delta === null) return null;
  const sign = change.delta > 0 ? "+" : "−";
  const magnitude = Math.abs(change.delta);
  const formatted = ["inr", "inr/kg", "inr/m"].includes(change.unit) ? formatCurrency(magnitude) : numberText(magnitude, change.unit === "kg/m" ? 6 : 3);
  return `${sign}${formatted}`;
}

function VersionHeading({ side, label }: { side: VersionSide; label: string }) {
  const status = typeof side.header.status === "string" ? side.header.status : null;
  return (
    <div className="rounded-2xl border border-slate-200 p-3 text-sm">
      <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-1 font-bold text-slate-900">Revision {side.revision_number}{side.kind === "current" ? " (current)" : ""}</p>
      <p className="text-xs font-semibold text-slate-600">Status at this version: {status ? status.replace(/_/g, " ") : NOT_RECORDED}</p>
      <p className="text-xs font-semibold text-slate-600">Last saved: {side.recorded_at ? formatDate(side.recorded_at) : NOT_RECORDED}</p>
      {side.approved_by_name ? <p className="text-xs font-semibold text-slate-600">Approved by {side.approved_by_name}</p> : null}
      {side.kind === "snapshot" ? (
        <p className="mt-1 text-xs font-semibold text-amber-800">
          Superseded {side.superseded_at ? formatDate(side.superseded_at) : ""}{side.superseded_by ? ` by ${side.superseded_by}` : ""}{side.reason ? `: “${side.reason}”` : ""}
          {isIssuedStatus(status) ? ". This version was issued to the customer; its instructions no longer apply." : "."}
        </p>
      ) : null}
    </div>
  );
}

function ChangeList({ changes, names }: { changes: FieldChange[]; names: Names }) {
  return (
    <ul className="space-y-1">
      {changes.map((change) => (
        <li key={change.key} className="text-xs">
          <span className="font-bold text-slate-800">{change.label}:</span>{" "}
          <span className="text-slate-500 line-through">{formatChangeValue(change.before, change.unit, change.key, names)}</span>{" → "}
          <span className="font-semibold text-slate-900">{formatChangeValue(change.after, change.unit, change.key, names)}</span>
          {deltaText(change) ? <span className="ml-1 text-slate-500">({deltaText(change)})</span> : null}
        </li>
      ))}
    </ul>
  );
}

// UPGRADE_EOS feature 25: two recorded quotation versions side by side.
export function QuoteRevisionComparison({ state }: { state: QuoteComparisonState }) {
  if (state.status === "error") {
    return <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">{state.message}</p>;
  }
  const { data, result, names } = state;
  const profileLabel = (line: (typeof result.lines)[number]) => (line.profileId ? names.profiles[line.profileId] : null) || "Unavailable profile";
  return (
    <div className="space-y-4" aria-label="Version comparison">
      <div className="grid gap-3 md:grid-cols-2">
        <VersionHeading side={data.from} label="Earlier version" />
        <VersionHeading side={data.to} label="Compared with" />
      </div>
      <p className="text-sm font-semibold text-slate-700">
        {result.summary.changed} line{result.summary.changed === 1 ? "" : "s"} changed, {result.summary.added} added, {result.summary.removed} removed, {result.summary.unchanged} unchanged; {result.summary.headerChanges} commercial term{result.summary.headerChanges === 1 ? "" : "s"} changed.
      </p>
      {data.linked_order ? (
        <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">
          {data.quote.status === "converted_to_order"
            ? `Order ${data.linked_order.order_number} was created on ${formatDate(data.linked_order.created_at)} from revision ${data.quote.current_revision}. Converted quotations cannot be revised, so that version stays as the accepted basis.`
            : `Order ${data.linked_order.order_number} (created ${formatDate(data.linked_order.created_at)}) is linked to this quotation.`}
        </p>
      ) : null}
      {result.header.length ? (
        <div className="rounded-2xl border border-slate-200 p-3">
          <p className="mb-2 text-xs font-black uppercase tracking-[0.12em] text-slate-500">Commercial terms</p>
          <ChangeList changes={result.header} names={names} />
        </div>
      ) : null}
      <div className="overflow-x-auto rounded-2xl border border-slate-200">
        <table className="industrial-table w-full min-w-[560px] text-sm">
          <thead><tr><th>Profile</th><th>Result</th><th>What changed</th></tr></thead>
          <tbody>
            {result.lines.map((line, index) => (
              <tr key={index}>
                <td className="font-bold text-slate-900">{profileLabel(line)}</td>
                <td>
                  <span className={line.status === "unchanged" ? "text-slate-500" : line.status === "removed" ? "font-bold text-red-700" : line.status === "added" ? "font-bold text-emerald-700" : "font-bold text-amber-800"}>
                    {line.status === "added" ? "Added" : line.status === "removed" ? "Removed" : line.status === "changed" ? "Changed" : "Unchanged"}
                  </span>
                </td>
                <td>
                  {line.status === "changed" ? <ChangeList changes={line.changes} names={names} /> : null}
                  {line.status === "added" || line.status === "removed" ? (
                    <span className="text-xs text-slate-600">
                      {formatChangeValue((line.after ?? line.before)?.quantity_pieces ?? null, "pcs", "quantity_pieces", names)} × {formatChangeValue((line.after ?? line.before)?.length_per_piece_m ?? null, "m", "length_per_piece_m", names)}, {formatChangeValue((line.after ?? line.before)?.finishing_type ?? null, "text", "finishing_type", names)}
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
            {!result.lines.length ? <tr><td colSpan={3} className="py-6 text-center font-semibold text-slate-500">Neither version has lines.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <p className="text-xs font-medium text-slate-500">
        Lines are matched by profile, first on the same cut length and finish, then in entry order. Draft edits made between recorded revisions are not versioned.
        {data.level === "basic" ? " Prices are hidden for your role." : data.level !== "cost" ? " Internal costs and margins are hidden for your role." : ""}
      </p>
    </div>
  );
}
