import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/layout/page-header";
import { RegisterRecord } from "@/components/modules/autopilot-batch9/registers";
import { getSessionContext } from "@/lib/auth";
import { REGISTER_CONFIRMERS, REGISTER_ROLES } from "@/lib/autopilot-batch9/commands";

export default async function RegisterPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await getSessionContext();
  if (context.dealerId || !(REGISTER_ROLES as readonly string[]).includes(context.role)) redirect("/production");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) redirect("/production/registers");
  return <div className="space-y-5">
    <PageHeader density="compact" title="Shift register" description="Type the cells from the photo; confirming adds only the pushes not already tapped." actions={<Link href="/production/registers" className="text-sm font-bold underline">All registers</Link>} />
    <RegisterRecord id={id} canConfirm={(REGISTER_CONFIRMERS as readonly string[]).includes(context.role)} />
  </div>;
}
