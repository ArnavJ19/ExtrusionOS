import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/layout/page-header";
import { RateCardRecord } from "@/components/modules/autopilot-batch9/rate-cards";
import { getSessionContext } from "@/lib/auth";
import { RATE_CARD_MAKERS, RATE_CARD_READERS } from "@/lib/autopilot-batch9/commands";

export default async function RateCardPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await getSessionContext();
  if (context.dealerId || !(RATE_CARD_READERS as readonly string[]).includes(context.role)) redirect("/quotes");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) redirect("/quotes/rate-cards");
  return <div className="mx-auto max-w-4xl space-y-5">
    <PageHeader density="compact" title="Rate card" description="What the customer receives: selling prices, validity and GST." actions={<Link href="/quotes/rate-cards" className="text-sm font-bold underline">All rate cards</Link>} />
    <RateCardRecord id={id} canShare={(RATE_CARD_MAKERS as readonly string[]).includes(context.role)} />
  </div>;
}
