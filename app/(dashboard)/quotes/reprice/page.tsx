import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { getSessionContext } from "@/lib/auth";
import { RepriceClient } from "@/components/modules/autopilot-batch6/reprice";
import { REPRICE_APPLIERS, REPRICE_READERS } from "@/lib/autopilot-batch6/commands";

export default async function RepricePage() {
  const context = await getSessionContext();
  if (context.dealerId || !(REPRICE_READERS as readonly string[]).includes(context.role)) redirect("/dashboard");
  return <div className="space-y-5"><PageHeader title="Reprice drafts" description="Apply today's approved billet rate to every draft quotation in one action." actions={<Link href="/quotes" className="text-sm font-bold underline print:hidden">Back to quotations</Link>} />
    <RepriceClient canApply={(REPRICE_APPLIERS as readonly string[]).includes(context.role)} /></div>;
}
