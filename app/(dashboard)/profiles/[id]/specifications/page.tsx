import {getSessionContext} from "@/lib/auth";
import {redirect} from "next/navigation";
import {TechnicalOptionsManager} from "@/components/modules/profiles/technical-options";
import {PageHeader} from "@/components/layout/page-header";
export default async function ProfileSpecificationsPage({params}:{params:Promise<{id:string}>}){
  const {id}=await params,context=await getSessionContext();
  if(context.dealerId||!["owner","admin","sales","sales_manager","production_manager","production","factory_manager","quality","inventory_manager","viewer"].includes(context.role))redirect("/dashboard");
  return <div className="space-y-5"><PageHeader title="Approved profile specifications" description="Retained technical options for the selected profile."/><TechnicalOptionsManager key={`${context.companyId}:${context.userId}:${context.role}:${id}`} profileId={id} actorId={context.userId} canWrite={["owner","admin","production_manager","quality"].includes(context.role)} canApprove={["owner","admin","quality"].includes(context.role)}/></div>;
}
