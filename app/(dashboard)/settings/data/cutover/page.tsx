import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { CutoverClient } from "@/components/modules/autopilot/cutover-client";
import { autopilotAction } from "@/lib/actions/autopilot";
import { getSessionContext } from "@/lib/auth";
import { CUTOVER_READERS, cutoverGetSchema } from "@/lib/cutover/cutover";

export default async function CutoverPage() {
  const context = await getSessionContext();
  if (context.dealerId || !(CUTOVER_READERS as readonly string[]).includes(context.role)) redirect("/dashboard");
  const result = await autopilotAction("ap_cutover", "get", {});
  const parsed = result.success ? cutoverGetSchema.safeParse(result.data) : null;
  return <div className="space-y-5">
    <PageHeader title="Opening balances and cut-over" description="Load opening stock, receivables, payables, open orders and dies at vendors as of the go-live date, then lock the earlier period."
      actions={["owner", "admin"].includes(context.role) ? <Link href="/settings/data/import" className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">Import masters first</Link> : null} />
    {parsed?.success ? <CutoverClient initial={parsed.data} />
      : <p role="alert" className="rounded-2xl bg-amber-50 p-4 text-sm font-semibold text-amber-900">{result.success ? "The cut-over plan returned an unexpected result." : result.error}</p>}
  </div>;
}
