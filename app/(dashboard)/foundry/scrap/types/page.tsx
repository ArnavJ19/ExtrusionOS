import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { ScrapTypesManager } from "@/components/modules/foundry/scrap-receiving/scrap-requests";
import { getSessionContext } from "@/lib/auth";
import { SCRAP_RECEIVERS, SCRAP_TYPE_MANAGERS } from "@/lib/foundry/scrap-receiving";

export default async function ScrapTypesPage() {
  const context = await getSessionContext();
  if (context.dealerId || !(SCRAP_RECEIVERS as readonly string[]).includes(context.role)) redirect("/foundry/scrap");
  return <div className="mx-auto max-w-3xl space-y-5">
    <PageHeader title="Scrap types" description="Wire, extrusion, local extrusion and sheet with or without attachments, imported, and any type you add." backHref="/foundry/scrap" backLabel="Aluminium scrap" />
    <ScrapTypesManager canAdd canManage={(SCRAP_TYPE_MANAGERS as readonly string[]).includes(context.role)} />
  </div>;
}
