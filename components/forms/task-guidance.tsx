const guidance = {
  quotation: [
    ["Start a quotation", "Select the customer and profile, enter pieces and cut length in metres, then check the commercial summary. Save quote records a draft; it does not approve, send, or convert it to an order."],
    ["Weight and recovery", "kg/m is the section weight per metre. Calculated weight is theoretical, not a weighing. Expected recovery is a planning assumption; it is not measured factory recovery."],
    ["Margin and charges", "Margin is profit as a share of selling price, not a markup on cost. A 20% selling margin on INR 250 cost gives INR 312.50. Check the charging unit for finishing and whether a line uses the quote GST rate or its own rate."],
  ],
  dispatch: [
    ["Prepare and review", "Select the order and exact material source for each tagged bundle. Review dispatch shows the proposed load before any stock is posted. Confirm dispatch rechecks the recorded material availability."],
    ["Measured quantities", "Gross kg includes the bundle packaging. Tare kg is that packaging weight. Net kg is gross minus tare. Enter actual pieces and actual metres; an estimate is not a physical observation."],
    ["When confirmation is uncertain", "If confirmation is lost, check dispatch records before trying again. A readiness check or a preview does not reserve stock or prove that a dispatch was recorded."],
  ],
} as const;

export function TaskGuidance({ task }: { task: keyof typeof guidance }) {
  return <details className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4"><summary className="cursor-pointer text-sm font-bold text-neutral-800">{task === "quotation" ? "Quotation entry help: units, margin, and saving" : "Dispatch entry help: measurements and confirmation"}</summary><dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3">{guidance[task].map(([term, explanation]) => <div key={term}><dt className="font-bold text-neutral-900">{term}</dt><dd className="mt-1 leading-6 text-neutral-600">{explanation}</dd></div>)}</dl></details>;
}
