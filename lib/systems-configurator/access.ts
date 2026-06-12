import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { can, type Action } from "@/lib/auth/permissions";

export async function getSystemsConfiguratorContext(action: Action = "read") {
  const context = await getSessionContext();
  if (!can(context.role, action, "systems_configurator")) redirect("/dashboard");
  return context;
}

export function canManageSystemTemplates(role: string) {
  return role === "owner" || role === "admin";
}
