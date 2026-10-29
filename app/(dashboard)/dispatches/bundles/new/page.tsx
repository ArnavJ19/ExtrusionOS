import { z } from "zod";
import Link from "next/link";
import { getSessionContext } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PhysicalBundleCapture } from "@/components/modules/dispatches/physical-bundles";
export default async function NewPhysicalBundlePage({searchParams}:{searchParams:Promise<{order_id?:string}>}){
  const context=await getSessionContext();
  if(context.dealerId||!["owner","admin","factory_manager","dispatch_manager","dispatch","inventory_manager"].includes(context.role))redirect("/dispatches");
  const query=await searchParams,id=z.string().uuid().safeParse(query.order_id);
  return id.success?<PhysicalBundleCapture key={`${context.companyId}:${context.userId}:${id.data}`} orderId={id.data}/>:<p>Select an order in <Link href="/dispatches/new" className="underline">dispatch preparation</Link> before recording bundles.</p>;
}
