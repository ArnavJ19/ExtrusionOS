import { ModuleOverviewClient } from "@/components/modules/operations/module-overview-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";
import Link from "next/link";
import { SCRAP_RECEIVERS } from "@/lib/foundry/scrap-receiving";
import { createClient } from "@/lib/supabase/server";

export default async function AluminiumScrapPage() {
  const context = await getSessionContext();
  if (!can(context.role, "read", "foundry")) redirect("/dashboard");
  const receiver = (SCRAP_RECEIVERS as readonly string[]).includes(context.role);
  const supabase = await createClient();
  const [open, exits, current] = receiver ? await Promise.all([
    supabase.rpc("ap_scrap_receipt", { p_command: "receipts", p_payload: { status: "in_progress" } }),
    supabase.rpc("ap_scrap_receipt", { p_command: "receipts", p_payload: { status: "exit_requested" } }),
    supabase.rpc("ap_scrap_receipt", { p_command: "current", p_payload: {} })
  ]) : [null, null, null];
  const inProgress = (open?.data as { total?: number } | null)?.total ?? 0;
  const exitRequests = (exits?.data as { total?: number } | null)?.total ?? 0;
  const mine = (current?.data as { id?: string | null } | null)?.id ?? null;
  return <ModuleOverviewClient moduleKey="foundry_scrap" context={context} canCreate={can(context.role, "create", "foundry")} canUpdate={can(context.role, "update", "foundry")}>
    {receiver ? <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Scrap receiving</p>
      <h2 className="section-title mt-1">Request and receive scrap</h2>
      <p className="mt-1 text-sm font-medium text-slate-500">Receive every load through the guided procedure. Prices and bills are added by accounts.</p>
      {mine ? <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm font-bold text-amber-900">You have a receipt in progress. Finish it before starting another.</p> : null}
      {context.role === "factory_manager" && exitRequests > 0 ? <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm font-bold text-rose-800">{exitRequests} receiver(s) asking to leave a receipt: only you can decide.</p> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href="/foundry/scrap/receive" className="inline-flex rounded-xl bg-charcoal px-4 py-2.5 text-sm font-bold text-white">{mine ? "Continue receiving" : "Start receiving scrap"}</Link>
        <Link href="/foundry/scrap/requests" className="inline-flex rounded-xl border border-charcoal px-4 py-2.5 text-sm font-bold">Request scrap</Link>
        <Link href={exitRequests > 0 ? "/foundry/scrap/receipts?status=exit_requested" : "/foundry/scrap/receipts"} className="inline-flex rounded-xl border border-charcoal px-4 py-2.5 text-sm font-bold">Receipts{inProgress ? ` (${inProgress} in progress)` : ""}</Link>
        <Link href="/foundry/scrap/types" className="inline-flex rounded-xl border border-charcoal px-4 py-2.5 text-sm font-bold">Scrap types</Link>
      </div>
    </div> : null}
  </ModuleOverviewClient>;
}
