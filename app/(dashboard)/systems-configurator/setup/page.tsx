import { redirect } from "next/navigation";

export default function LegacyConfiguratorSetupPage() {
  redirect("/systems-configurator/libraries");
}
