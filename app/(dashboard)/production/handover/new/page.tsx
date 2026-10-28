import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { NewHandoverForm } from "@/components/modules/production/shift-handover";
import { getSessionContext } from "@/lib/auth";
import { canSubmitHandover } from "@/lib/workflow/shift-handover";

export default async function NewShiftHandoverPage() {
  const context = await getSessionContext();
  if (context.dealerId || !canSubmitHandover(context.role)) redirect("/production/handover");
  return (
    <div className="space-y-5">
      <PageHeader
        title="Prepare Shift Handover"
        description="The summary is built from recorded production, downtime, quality and dispatch activity. Add what the records do not show, then submit."
        actions={<Link href="/production/handover" className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">All handovers</Link>}
      />
      <NewHandoverForm />
    </div>
  );
}
