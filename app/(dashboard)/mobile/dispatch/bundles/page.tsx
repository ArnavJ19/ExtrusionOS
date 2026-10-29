import Link from "next/link";
import { z } from "zod";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canRecordMobileBundle,mobileBundleQueueSchema } from "@/lib/workflow/mobile-bundle-task";
import { PhysicalBundleCapture } from "@/components/modules/dispatches/physical-bundles";
export default async function MobileBundleTaskPage({searchParams}:{searchParams:Promise<{order_id?:string;page?:string;search?:string}>}){
  const context=await getSessionContext();if(!canRecordMobileBundle(context.role,context.dealerId))redirect("/mobile");
  const query=await searchParams;
  if(query.order_id){const id=z.string().uuid().safeParse(query.order_id);return id.success?<PhysicalBundleCapture key={`${context.companyId}:${context.userId}:${id.data}`} orderId={id.data}/>:<p role="alert">That order reference is invalid. <Link href="/mobile/dispatch/bundles" className="underline">Choose an order</Link></p>;}
  const parsed=mobileBundleQueueSchema.safeParse({page:query.page??1,search:query.search??""});
  if(!parsed.success)return <p role="alert">Check the order search or page number.</p>;
  const {page,search}=parsed.data,client=await createClient();
  let request=client.from("orders_authorized").select("id,order_number,customer_name,company_name",{count:"exact"}).eq("company_id",context.companyId)
    .not("current_stage","in","(cancelled,delivered)").order("order_date",{ascending:false}).order("id");
  if(search)request=request.ilike("order_number",`%${search.replace(/[\\%_]/g,"\\$&")}%`);
  const result=await request.range((page-1)*10,page*10-1);
  const href=(n:number)=>`/mobile/dispatch/bundles?page=${n}&search=${encodeURIComponent(search)}`;
  return <div className="mx-auto max-w-xl space-y-4"><h1 className="text-2xl font-black">Measure a bundle</h1><p className="text-sm text-slate-600">Choose its order, then record the tag and physical measurements.</p>
    <form className="space-y-2"><label className="block">Find order<input name="search" aria-label="Find order" className="form-input min-h-12" defaultValue={search} maxLength={80}/></label><button className="min-h-12 rounded-xl bg-slate-900 px-5 font-bold text-white">Find order</button></form>
    {result.error?<p role="alert">Orders could not be loaded. Refresh before assuming the queue is empty.</p>:result.data?.length?result.data.map(row=><Link key={row.id} href={`/mobile/dispatch/bundles?order_id=${row.id}`} className="block min-h-16 break-words rounded-2xl border bg-white p-4"><span className="block font-bold">{row.order_number}</span><span className="text-sm text-slate-600">{row.company_name||row.customer_name}</span></Link>):<p>No orders match this page.</p>}
    <nav aria-label="Bundle order pages" className="flex justify-between gap-4">{page>1?<Link href={href(page-1)}>Previous orders</Link>:<span/>}<span>Page {page}</span>{!result.error&&page*10<(result.count??0)?<Link href={href(page+1)}>Next orders</Link>:<span/>}</nav>
  </div>;
}
