import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { PeriodsClient } from "@/components/modules/autopilot/periods-client";
import { ProposalCards } from "@/components/modules/autopilot/proposal-cards";
import { autopilotAction } from "@/lib/actions/autopilot";
import { getSessionContext } from "@/lib/auth";
import { periodOverviewSchema } from "@/lib/periods/periods";
import { proposalListSchema } from "@/lib/proposals/proposals";
import { CloseChecklist } from "@/components/modules/autopilot-operations/operations";
import { getBusinessDateBoundaries } from "@/lib/utils/business-date";

export default async function AccountingPeriodsPage() {
  const context = await getSessionContext();
  const today = getBusinessDateBoundaries(new Date()).today;
  const previousMonth = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  previousMonth.setUTCMonth(previousMonth.getUTCMonth() - 1);
  const [overview, proposals] = await Promise.all([autopilotAction("ap_period", "overview", {}), autopilotAction("ap_proposals", "list", { type: "period.close_month", status: "open" })]);
  const parsed = overview.success ? periodOverviewSchema.safeParse(overview.data) : null;
  const parsedProposals = proposals.success ? proposalListSchema.safeParse(proposals.data) : null;
  return <div className="space-y-5">
    <PageHeader title="Month close" description="Close finished months, approve exceptions to post into a closed month, and review back-dated entries."
      actions={<Link href="/invoices" className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">Back to invoices</Link>} />
    {["owner", "admin", "accounts"].includes(context.role) ? <CloseChecklist initialMonth={previousMonth.toISOString().slice(0, 7)} canNominate={["owner", "admin"].includes(context.role)} /> : null}
    {parsed?.success && (parsed.data.can_close_month ?? parsed.data.can_close) ? <ProposalCards type="period.close_month" today={parsed.data.today} title="Month close prepared for you"
      initial={parsedProposals?.success ? parsedProposals.data : null} initialError={parsedProposals?.success ? null : proposals.success ? "Proposals could not be read." : proposals.error}
      emptyText="No month is waiting to be closed. After the close day each month, the morning job prepares the close for you to accept." /> : null}
    {parsed?.success ? <PeriodsClient initial={parsed.data} userId={context.userId} />
      : <p role="alert" className="rounded-2xl bg-amber-50 p-4 text-sm font-semibold text-amber-900">{overview.success ? "Accounting periods could not be read." : overview.error}</p>}
  </div>;
}
