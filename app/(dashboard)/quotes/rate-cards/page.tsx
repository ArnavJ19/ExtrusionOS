import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { RateCardsClient } from "@/components/modules/autopilot-batch9/rate-cards";
import { getSessionContext } from "@/lib/auth";
import { RATE_CARD_MAKERS, RATE_CARD_READERS } from "@/lib/autopilot-batch9/commands";

// AP-073: customer rate cards from today's approved rates (selling prices only).
export default async function RateCardsPage() {
  const context = await getSessionContext();
  if (context.dealerId || !(RATE_CARD_READERS as readonly string[]).includes(context.role)) redirect("/quotes");
  return <div className="space-y-5">
    <PageHeader title="Rate cards" description="Today's selling rate per kg by profile family, alloy and finish, for one customer or a whole category. Share the PDF or the WhatsApp text yourself." actions={<Link href="/quotes" className="text-sm font-bold underline">Back to quotations</Link>} />
    <RateCardsClient canMake={(RATE_CARD_MAKERS as readonly string[]).includes(context.role)} />
  </div>;
}
