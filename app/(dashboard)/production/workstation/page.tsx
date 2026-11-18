import { getBusinessDateBoundaries } from "@/lib/utils/business-date";
import { getSessionContext } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Workstation } from "@/components/modules/production/workstation";
import { getFloorLanguage } from "@/lib/i18n/floor-server";
export default async function WorkstationPage(){const context=await getSessionContext();
  if(context.dealerId||!["owner","admin","production_manager","production","factory_manager"].includes(context.role))redirect("/dashboard");
  return <Workstation lang={await getFloorLanguage()} key={`${context.companyId}:${context.userId}:${context.role}`} companyId={context.companyId} userId={context.userId} operatorName={context.fullName||context.email||"Signed-in operator"} today={getBusinessDateBoundaries().today}/>;
}
