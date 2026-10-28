import {supplierComparisonAction} from "@/lib/actions/supplier-comparisons";
import {PageHeader} from "@/components/layout/page-header";
import Link from "next/link";
export default async function SupplierComparisonsPage(){
  const result=await supplierComparisonAction({command:"requests.list"});
  return <div className="space-y-5"><PageHeader title="Supplier offer comparisons" description="Agree the purchase specification and compare supplier terms on a consistent basis."/>{result.success&&result.kind==="directory"?<><div className="flex flex-wrap gap-4"><Link className="font-bold underline" href="/vendors/comparisons/new">New purchase comparison</Link><Link className="font-bold underline" href="/vendors/comparisons/database">View database</Link></div><div className="grid gap-4 sm:grid-cols-2">{result.data.items.slice(0,6).map(item=><Link className="space-y-2 rounded-2xl border bg-white p-5" key={item.id} href={`/vendors/comparisons/${item.id}`}><h2 className="font-bold">{item.title}</h2><p className="text-sm">{item.quantity} {item.unit} · required by {item.required_by||"Not captured"}</p></Link>)}</div>{!result.data.items.length?<p>No purchase comparisons yet.</p>:null}</>:<p role="alert">{result.success?"Unavailable":result.error}</p>}</div>;
}
