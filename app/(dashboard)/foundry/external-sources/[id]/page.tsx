import { RecordDetailClient } from "@/components/modules/operations/record-detail-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ErpControlPanel } from "@/components/modules/erp-control-panel";
import { alloyDeviationControls, metalSourceDispositionControls } from "@/lib/workflow/erp-control-panels";

export default async function ExternalSourceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSessionContext();
  if (!can(context.role, "read", "foundry")) redirect("/dashboard");
  const supabase = await createClient();
  const { data: source } = await supabase.from("foundry_external_aluminium_sources").select("id, alloy, status, available_weight_kg").eq("company_id", context.companyId).eq("id", id).maybeSingle();
  const controls = source ? alloyDeviationControls(context, "foundry_external_aluminium_sources", id, source.alloy ?? null) : [];
  const dispositions = source ? metalSourceDispositionControls(context, "foundry_external_aluminium_sources", source) : [];
  return <div className="space-y-6">
    <RecordDetailClient moduleKey="foundry_external_sources" context={context} recordId={id} canEdit={can(context.role, "update", "foundry")} />
    <ErpControlPanel title="Lot disposition" actions={dispositions} />
    <ErpControlPanel title="Alloy segregation" actions={controls} />
  </div>;
}
