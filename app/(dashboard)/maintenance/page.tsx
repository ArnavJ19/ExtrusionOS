import { getBusinessDateBoundaries } from "@/lib/utils/business-date";
import { ErpControlPanel } from "@/components/modules/erp-control-panel";
import { MaintenanceWorkspaceClient } from "@/components/modules/maintenance/maintenance-workspace-client";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { maintenanceControls } from "@/lib/workflow/erp-control-panels";
import { PmPanel } from "@/components/modules/press/pm-panel";

export default async function MaintenancePage() {
  // Access follows the maintenance tables' RLS (owner, admin, production manager), as before.
  const context = await getSessionContext();
  const controls = await maintenanceControls(await createClient(), context);
  return (
    <div className="space-y-6">
      {!context.dealerId ? <PmPanel today={getBusinessDateBoundaries().today} /> : null}
      <MaintenanceWorkspaceClient />
      <ErpControlPanel title="Maintenance completion and sign-off" actions={controls} />
    </div>
  );
}
