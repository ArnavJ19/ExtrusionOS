import { SystemsConfiguratorOverview } from "@/components/modules/systems-configurator/route-shell";
import { getSystemsConfiguratorContext } from "@/lib/systems-configurator/access";

export default async function SystemsConfiguratorPage() {
  await getSystemsConfiguratorContext("read");
  return <SystemsConfiguratorOverview />;
}
