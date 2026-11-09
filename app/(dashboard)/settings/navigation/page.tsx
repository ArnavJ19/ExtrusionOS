import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { NavigationClient } from "@/components/modules/autopilot/navigation-client";
import { ProposalCards } from "@/components/modules/autopilot/proposal-cards";
import { autopilotAction } from "@/lib/actions/autopilot";
import { getSessionContext } from "@/lib/auth";
import { hasRouteAccess } from "@/lib/auth/route-permissions";
import { APP_DESTINATIONS } from "@/lib/navigation/app-destinations";
import { NAV_ROLES, navigationUsageSchema } from "@/lib/navigation/role-navigation";
import { proposalListSchema } from "@/lib/proposals/proposals";
import { getBusinessDateBoundaries } from "@/lib/utils/business-date";

export default async function NavigationSettingsPage() {
  const context = await getSessionContext();
  if (!["owner", "admin"].includes(context.role)) redirect("/dashboard");
  const [usage, proposals] = await Promise.all([autopilotAction("ap_navigation", "usage", {}), autopilotAction("ap_proposals", "list", { type: "navigation.role_layout", status: "open" })]);
  const parsed = usage.success ? navigationUsageSchema.safeParse(usage.data) : null;
  const parsedProposals = proposals.success ? proposalListSchema.safeParse(proposals.data) : null;
  // Only destinations the role can open are offered; the shell filters again by feature flag when it renders.
  const destinations = Object.fromEntries(NAV_ROLES.map(role => [role, APP_DESTINATIONS.filter(item => (item.roles as readonly string[]).includes(role) && hasRouteAccess(item.href, role)).map(({ href, label }) => ({ href, label }))]));
  return <div className="space-y-5">
    <PageHeader title="Navigation" description="Keep each role's main navigation to the places it actually uses."
      actions={<Link href="/settings" className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">Back to settings</Link>} />
    <ProposalCards type="navigation.role_layout" today={getBusinessDateBoundaries(new Date()).today} title="Navigation prepared from usage"
      initial={parsedProposals?.success ? parsedProposals.data : null} initialError={parsedProposals?.success ? null : proposals.success ? "Proposals could not be read." : proposals.error}
      emptyText="No navigation change is waiting. After two weeks of visits for a role, the nightly job proposes its most used destinations." />
    {parsed?.success ? <NavigationClient initial={parsed.data} destinations={destinations} />
      : <p role="alert" className="rounded-2xl bg-amber-50 p-4 text-sm font-semibold text-amber-900">{usage.success ? "Usage could not be read." : usage.error}</p>}
  </div>;
}
