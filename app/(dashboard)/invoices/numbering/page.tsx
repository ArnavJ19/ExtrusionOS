import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { NumberingClient } from "@/components/modules/autopilot/numbering-client";
import { ProposalCards } from "@/components/modules/autopilot/proposal-cards";
import { autopilotAction } from "@/lib/actions/autopilot";
import { getSessionContext } from "@/lib/auth";
import { seriesListSchema } from "@/lib/numbering/financial-year";
import { proposalListSchema } from "@/lib/proposals/proposals";
import { getBusinessDateBoundaries } from "@/lib/utils/business-date";

export default async function DocumentNumberingPage() {
  await getSessionContext();
  const today = getBusinessDateBoundaries(new Date()).today;
  const [series, proposals] = await Promise.all([autopilotAction("ap_series", "list", {}), autopilotAction("ap_proposals", "list", { type: "series.adopt", status: "open" })]);
  const parsedSeries = series.success ? seriesListSchema.safeParse(series.data) : null;
  const parsedProposals = proposals.success ? proposalListSchema.safeParse(proposals.data) : null;
  return <div className="space-y-5">
    <PageHeader title="Document numbering" description="Invoice, credit note, quotation, order and challan numbers that restart every financial year on 1 April."
      actions={<Link href="/invoices" className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">Back to invoices</Link>} />
    <ProposalCards type="series.adopt" today={today} title="Formats prepared for you" initial={parsedProposals?.success ? parsedProposals.data : null}
      initialError={parsedProposals?.success ? null : proposals.success ? "Proposals could not be read." : proposals.error}
      emptyText="No format is waiting. Every document type either has a confirmed series or will get a proposal from the nightly job." />
    {parsedSeries?.success ? <NumberingClient initial={parsedSeries.data} today={today} />
      : <p role="alert" className="rounded-2xl bg-amber-50 p-4 text-sm font-semibold text-amber-900">{series.success ? "Number series could not be read." : series.error}</p>}
  </div>;
}
