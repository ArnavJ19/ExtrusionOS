import Link from "next/link";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { BASES, CHECK_LABELS, RATE_TYPES, lineAttention, type Basis, type QuoteRateCheck, type RateCheckStatus } from "@/lib/workflow/costing-rates";

const tone: Record<RateCheckStatus, string> = {
  matches: "bg-emerald-100 text-emerald-800", above_approved: "bg-sky-100 text-sky-800", below_approved: "bg-red-100 text-red-800",
  no_rate: "bg-slate-100 text-slate-700", expired_rate: "bg-amber-100 text-amber-900"
};
const basisText = (basis: string) => (basis in BASES ? BASES[basis as Basis] : basis);

// UPGRADE_EOS feature 85: each line's billet, conversion and finishing rate against the approved rate
// for the quote date (or the rates bound when the quotation was approved for sending). Internal only.
export function QuoteRateCheckPanel({ check }: { check: QuoteRateCheck }) {
  const noRates = check.lines.every((line) => line.checks.every((item) => item.status === "no_rate"));
  if (noRates && !check.bound) {
    return <p className="text-sm text-slate-600">No approved costing rates apply on {formatDate(check.quote_date)}. <Link href="/quotes/rates" className="font-bold underline">Set up rates</Link> to check entered billet, conversion and finishing rates.</p>;
  }
  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs text-slate-600">
        {check.bound
          ? `Revision ${check.revision_number} was approved with the rates below; later rate changes do not alter it.`
          : `Compared with the approved rates applicable on the quote date, ${formatDate(check.quote_date)}. Rates are bound when the quotation is approved for sending.`}
      </p>
      {check.bound ? (
        <ul className="flex flex-wrap gap-2 text-xs">
          {check.bindings.map((binding) => (
            <li key={binding.id} className="rounded-full border border-slate-200 px-2 py-1 font-semibold">
              {RATE_TYPES[binding.rate_type]}{binding.finishing_type ? ` (${binding.finishing_type.replace(/_/g, " ")})` : ""}: {formatCurrency(binding.rate)} {basisText(binding.basis)}{binding.customer_specific ? " · customer agreement" : ""}
            </li>
          ))}
        </ul>
      ) : null}
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
        {check.lines.map((line) => {
          const attention = lineAttention(line.checks);
          return (
            <li key={line.item_id} className="space-y-1 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-bold">{line.description}</p>
                <span className={`rounded-full px-2 py-0.5 text-xs font-black ${tone[attention]}`}>{CHECK_LABELS[attention]}</span>
              </div>
              <ul className="grid gap-1 text-xs md:grid-cols-3">
                {line.checks.map((item) => (
                  <li key={`${item.rate_type}-${item.finishing_type ?? ""}`} className="rounded-lg bg-slate-50 px-2 py-1">
                    <span className="font-bold">{RATE_TYPES[item.rate_type]}{item.finishing_type ? ` (${item.finishing_type.replace(/_/g, " ")})` : ""}</span>{" "}
                    entered {item.entered === null ? "-" : formatCurrency(item.entered)}
                    {item.approved !== null ? ` · approved ${formatCurrency(item.approved)} ${basisText(item.basis)}${item.source === "customer" ? " (customer agreement)" : item.source === "bound" ? " (bound)" : ""}` : ""}
                    <span className={`ml-1 rounded px-1 font-bold ${tone[item.status]}`}>{item.status === "expired_rate" && item.expired_on ? `expired ${formatDate(item.expired_on)}` : CHECK_LABELS[item.status]}</span>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
