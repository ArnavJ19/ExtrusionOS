import { SystemsConfiguratorOverview } from "@/components/modules/systems-configurator/route-shell";
import { SystemsOrderSetting } from "@/components/modules/autopilot-batch10/systems-order";
import { SYSTEM_ORDER_ROLES } from "@/lib/autopilot-batch10/commands";
import { getSystemsConfiguratorContext } from "@/lib/systems-configurator/access";

export default async function SystemsConfiguratorPage() {
  const context = await getSystemsConfiguratorContext("read");
  // AP-070: the owner's decision whether projects may be opened as orders.
  const showSetting = Boolean(context) && !context.dealerId && (SYSTEM_ORDER_ROLES as readonly string[]).includes(context.role);
  return <div className="space-y-6"><SystemsConfiguratorOverview />{showSetting ? <SystemsOrderSetting /> : null}</div>;
}
