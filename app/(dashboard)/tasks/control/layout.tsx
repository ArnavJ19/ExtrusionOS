import { getSessionContext } from "@/lib/auth";
import { redirect } from "next/navigation";
import { canReadControl } from "@/lib/workflow/operations-control";
import { ControlActionCenter } from "@/components/modules/control/action-center";

export default async function ControlLayout({ children }: { children: React.ReactNode }) {
  const context = await getSessionContext();
  if (context.dealerId || !canReadControl(context.role)) redirect("/tasks");
  return <div className="min-w-0 space-y-5"><ControlActionCenter key={`${context.companyId}:${context.userId}:${context.role}`} context={context}>{children}</ControlActionCenter></div>;
}
