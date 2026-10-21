import { SettingsClient } from "@/components/modules/settings-client";
import { CompanyControlsForm } from "@/components/modules/company-controls-form";
import { ErpControlPanel } from "@/components/modules/erp-control-panel";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { booksLockControls } from "@/lib/workflow/erp-control-panels";

export default async function SettingsPage() {
  const context = await getSessionContext();
  const supabase = await createClient();
  const [companyResult, settingsResult, controlsResult, lockResult] = await Promise.all([
    supabase.from("companies").select("*").eq("id", context.companyId).single(),
    supabase.from("company_settings_authorized").select("*").eq("company_id", context.companyId).maybeSingle(),
    supabase.from("company_settings").select("delivery_completion_tolerance_percent, metal_receipt_max_kg, metal_receipt_weighbridge_threshold_kg").eq("company_id", context.companyId).maybeSingle(),
    supabase.rpc("get_books_locked_through")
  ]);
  const controls = controlsResult.data;
  return (
    <div className="space-y-6">
      <SettingsClient context={context} company={companyResult.data ?? { id: context.companyId, name: context.companyName }} settings={settingsResult.data} />
      {controls ? <CompanyControlsForm canEdit={["owner", "admin"].includes(context.role)} initial={{
        delivery_completion_tolerance_percent: Number(controls.delivery_completion_tolerance_percent ?? 0),
        metal_receipt_max_kg: Number(controls.metal_receipt_max_kg ?? 60000),
        metal_receipt_weighbridge_threshold_kg: Number(controls.metal_receipt_weighbridge_threshold_kg ?? 10000)
      }} /> : null}
      <ErpControlPanel title="Accounting period" actions={booksLockControls(context, lockResult.data ? String(lockResult.data) : null)} />
    </div>
  );
}
