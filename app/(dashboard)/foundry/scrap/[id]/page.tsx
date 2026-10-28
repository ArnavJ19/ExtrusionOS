import { RecordDetailClient } from "@/components/modules/operations/record-detail-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ErpControlPanel } from "@/components/modules/erp-control-panel";
import { alloyDeviationControls, metalSourceDispositionControls } from "@/lib/workflow/erp-control-panels";

export default async function AluminiumScrapDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSessionContext();
  if (!can(context.role, "read", "foundry")) redirect("/dashboard");
  const supabase = await createClient();
  const { data: source } = await supabase.from("foundry_aluminium_scrap").select("id, alloy, status, available_weight_kg, scrap_source").eq("company_id", context.companyId).eq("id", id).maybeSingle();
  const controls = source ? alloyDeviationControls(context, "foundry_aluminium_scrap", id, source.alloy ?? null) : [];
  const dispositions = source ? metalSourceDispositionControls(context, "foundry_aluminium_scrap", source) : [];
  return <div className="space-y-6">
    <RecordDetailClient moduleKey="foundry_scrap" context={context} recordId={id} canEdit={can(context.role, "update", "foundry")} />
    <ErpControlPanel title="Lot disposition" actions={dispositions} />
    <ErpControlPanel title="Alloy segregation" actions={controls} />
  </div>;
}
