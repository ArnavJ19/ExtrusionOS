import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/layout/page-header";
import { ScrapSaleRecord } from "@/components/modules/autopilot-batch9/scrap-sales";
import { getSessionContext } from "@/lib/auth";
import { SCRAP_MANAGERS, SCRAP_MONEY, SCRAP_READERS } from "@/lib/autopilot-batch9/commands";

export default async function ScrapSalePage({ params }: { params: Promise<{ id: string }> }) {
  const context = await getSessionContext();
  if (context.dealerId || !(SCRAP_READERS as readonly string[]).includes(context.role)) redirect("/foundry");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) redirect("/foundry/scrap-sales");
  return <div className="mx-auto max-w-4xl space-y-5">
    <PageHeader density="compact" title="Scrap sale" description="Weigh, invoice and record the receipt." actions={<Link href="/foundry/scrap-sales" className="text-sm font-bold underline">All scrap sales</Link>} />
    <ScrapSaleRecord id={id} canManage={(SCRAP_MANAGERS as readonly string[]).includes(context.role)} canMoney={(SCRAP_MONEY as readonly string[]).includes(context.role)} />
  </div>;
}
