import { RecordDetailClient } from "@/components/modules/operations/record-detail-client";
import { BilletAllocationClient } from "@/components/modules/foundry/billet-allocation-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ErpControlPanel } from "@/components/modules/erp-control-panel";
import { billetControls } from "@/lib/workflow/erp-control-panels";

export default async function FoundryBilletDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const context = await getSessionContext();
  if (!can(context.role, "read", "foundry")) redirect("/dashboard");
  const supabase = await createClient();
  const { data: billet } = await supabase.from("foundry_billets").select("id, status, production_job_id").eq("company_id", context.companyId).eq("id", params.id).maybeSingle();
  const controls = billet ? billetControls(context, billet as any) : [];
  return (
    <div className="space-y-6">
      <RecordDetailClient moduleKey="foundry_billets" recordId={params.id} context={context} canEdit={false} />
      {can(context.role, "update", "foundry") ? <BilletAllocationClient context={context} billetId={params.id} /> : null}
      <ErpControlPanel title="Billet quality" actions={controls} />
    </div>
  );
}
