import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { EquivalentShortages } from "@/components/modules/autopilot-batch10/equivalents";
import { getSessionContext } from "@/lib/auth";
import { EQUIVALENT_ROLES } from "@/lib/autopilot-batch10/commands";

// AP-049: open order lines that are short where an approved equivalent profile has free stock.
export default async function EquivalentShortagesPage() {
  const context = await getSessionContext();
  if (context.dealerId || !(EQUIVALENT_ROLES as readonly string[]).includes(context.role)) redirect("/orders");
  return <div className="space-y-5">
    <PageHeader title="Equivalents for shortages" description="Short order lines that an approved equivalent in stock could cover. Record the customer's consent on the order before substituting." actions={<Link href="/orders" className="text-sm font-bold underline">Back to orders</Link>} />
    <EquivalentShortages />
  </div>;
}
