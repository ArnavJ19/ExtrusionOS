import { RecordDetailClient } from "@/components/modules/operations/record-detail-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function QualityInspectionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSessionContext();
  if (!can(context.role, "read", "quality")) redirect("/dashboard");
  const supabase = await createClient();
  const { data: inspection } = await supabase
    .from("quality_inspections")
    .select("status")
    .eq("company_id", context.companyId)
    .eq("id", id)
    .maybeSingle();
  const terminal = ["approved", "rejected", "rework"].includes(String(inspection?.status ?? ""));
  return <RecordDetailClient moduleKey="quality" context={context} recordId={id} canEdit={!terminal && can(context.role, "update", "quality")} />;
}
