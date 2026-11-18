import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { NewRegisterCapture, RegisterList } from "@/components/modules/autopilot-batch9/registers";
import { getSessionContext } from "@/lib/auth";
import { REGISTER_ROLES } from "@/lib/autopilot-batch9/commands";
import { getBusinessDateBoundaries } from "@/lib/utils/business-date";

// AP-009: photographed paper shift registers turned into confirmed press records.
export default async function RegistersPage() {
  const context = await getSessionContext();
  if (context.dealerId || !(REGISTER_ROLES as readonly string[]).includes(context.role)) redirect("/production");
  return <div className="space-y-5">
    <PageHeader title="Shift registers" description="Photograph the paper press log; the system lines it up with the shift's jobs and the pushes already tapped." actions={<Link href="/production/floor" className="text-sm font-bold underline">Press floor</Link>} />
    <NewRegisterCapture companyId={context.companyId} today={getBusinessDateBoundaries().today} />
    <RegisterList />
  </div>;
}
