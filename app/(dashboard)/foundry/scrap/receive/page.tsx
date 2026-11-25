import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { ReceiveWizard } from "@/components/modules/foundry/scrap-receiving/receive-wizard";
import { getSessionContext } from "@/lib/auth";
import { SCRAP_RECEIVERS } from "@/lib/foundry/scrap-receiving";
import { createClient } from "@/lib/supabase/server";

// Guided scrap receipt: presence at the site, visual verification with the weighbridge weight, then material details.
export default async function ReceiveScrapPage({ searchParams }: { searchParams: Promise<{ request?: string }> }) {
  const context = await getSessionContext();
  if (context.dealerId || !(SCRAP_RECEIVERS as readonly string[]).includes(context.role)) redirect("/foundry/scrap");
  const params = await searchParams;
  const supabase = await createClient();
  const current = await supabase.rpc("ap_scrap_receipt", { p_command: "current", p_payload: {} });
  const receiptId = (current.data as { id: string | null } | null)?.id ?? null;
  const requestId = typeof params.request === "string" && /^[0-9a-f-]{36}$/i.test(params.request) ? params.request : null;
  return <div className="mx-auto max-w-4xl space-y-5">
    <PageHeader title={receiptId ? "Continue receiving scrap" : "Start receiving scrap"} description="Follow every step. After you confirm presence at the site the receipt can only be closed by completing it, or with the factory manager's approval."
      actions={<Link href="/foundry/scrap/receipts" className="text-sm font-bold underline">All receipts</Link>} />
    {current.error ? <p role="alert" className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">Scrap receiving needs the foundry receiving database upgrade. Ask the administrator to apply it.</p>
      : <ReceiveWizard companyId={context.companyId} initialReceiptId={receiptId} initialRequestId={requestId} />}
  </div>;
}
