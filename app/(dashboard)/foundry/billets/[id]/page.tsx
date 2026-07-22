import { RecordDetailClient } from "@/components/modules/operations/record-detail-client";
import { BilletAllocationClient } from "@/components/modules/foundry/billet-allocation-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function FoundryBilletDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const context = await getSessionContext();
  if (!can(context.role, "read", "foundry")) redirect("/dashboard");
  return (
    <div className="space-y-6">
      <RecordDetailClient moduleKey="foundry_billets" recordId={params.id} context={context} canEdit={false} />
      {can(context.role, "update", "foundry") ? <BilletAllocationClient context={context} billetId={params.id} /> : null}
    </div>
  );
}
