import { notFound, redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { SampleClient } from "@/components/modules/press/sampling-client";

export default async function QualitySamplePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  const context = await getSessionContext();
  if (context.dealerId || !["owner", "admin", "quality", "factory_manager", "production_manager", "production"].includes(context.role)) redirect("/dashboard");
  return <div className="mx-auto max-w-3xl"><SampleClient id={id} /></div>;
}
