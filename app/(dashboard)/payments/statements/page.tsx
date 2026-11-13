import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { getSessionContext } from "@/lib/auth";
import { StatementsClient } from "@/components/modules/autopilot-batch7/statements";
import { STATEMENT_ROLES } from "@/lib/autopilot-batch7/commands";

// AP-079: monthly customer statements queued on the first working day of the month.
export default async function StatementsPage() {
  const context = await getSessionContext();
  if (context.dealerId || !(STATEMENT_ROLES as readonly string[]).includes(context.role)) redirect("/payments");
  return <div className="space-y-5">
    <PageHeader title="Monthly statements" description="Prepared each month for every customer with a balance. Nothing reaches a customer until you send it and record it."
      actions={<Link href="/payments" className="text-sm font-bold underline">Back to payments</Link>} />
    <StatementsClient />
  </div>;
}
