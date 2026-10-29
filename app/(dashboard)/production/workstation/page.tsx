import { getSessionContext } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Workstation } from "@/components/modules/production/workstation";
export default async function WorkstationPage(){const context=await getSessionContext();
  if(context.dealerId||!["owner","admin","production_manager","production","factory_manager"].includes(context.role))redirect("/dashboard");
  return <Workstation key={`${context.companyId}:${context.userId}:${context.role}`} companyId={context.companyId} userId={context.userId} operatorName={context.fullName||context.email||"Signed-in operator"}/>;
}
