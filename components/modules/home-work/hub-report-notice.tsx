// AP-041: the /tasks hubs are cross-record reports. Daily work starts from the record it belongs to.
export function HubReportNotice() {
  return <p className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
    This is a report across records. To start new work, open the order, job, die, dispatch, invoice, vendor or customer it belongs to and use <strong>Related work</strong> there; module-wide work is under <strong>More workflows</strong> on the module page.
  </p>;
}
