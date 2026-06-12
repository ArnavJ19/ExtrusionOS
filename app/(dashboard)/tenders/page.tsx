import { redirect } from "next/navigation";
import { TendersClient } from "@/components/modules/tenders-client";
import { ModuleDisabled } from "@/components/ui/module-disabled";
import { getSessionContext } from "@/lib/auth";
import { getFeatureFlagsForCompany, isFeatureEnabled } from "@/lib/enterprise/features";
import { createClient } from "@/lib/supabase/server";

export default async function TendersPage() {
  const context = await getSessionContext();
  if (!["owner", "admin", "sales_manager"].includes(context.role)) redirect("/dashboard");

  const supabase = await createClient();
  const flags = await getFeatureFlagsForCompany(supabase, context.companyId);
  if (!isFeatureEnabled(flags, "tender_management")) return <ModuleDisabled moduleName="tender_management" title="Tender Management" />;

  const tendersResult = await supabase
    .from("tenders")
    .select("id, tender_number, tender_title, issuing_authority, sector, tender_url, publish_date, submission_deadline, estimated_value, emd_amount, emd_status, document_fee, bid_value, status, technical_status, commercial_status, competitor_notes, assigned_to, result_date, converted_order_id, notes, created_at")
    .eq("company_id", context.companyId)
    .order("submission_deadline", { ascending: true })
    .limit(100);

  return <TendersClient initialTenders={(tendersResult.data ?? []) as any[]} canCreate={["owner", "admin", "sales_manager"].includes(context.role)} />;
}
