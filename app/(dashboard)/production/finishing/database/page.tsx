import Link from 'next/link';
import {redirect} from 'next/navigation';
import {Card,CardHeader,CardContent} from '@/components/ui/card';
import {Badge} from '@/components/ui/badge';
import {ErrorState} from '@/components/ui/error-state';
import {PageHeader} from '@/components/layout/page-header';
import {getSessionContext} from '@/lib/auth';
import {can} from '@/lib/auth/permissions';
import {createClient} from '@/lib/supabase/server';
import {formatDate,formatWeight} from '@/lib/utils/format';
import {labelize} from '@/types/app';
import {finishingStatuses,finishingSorts,finishingWorkloadHref,getFinishingWorkloadOptions,loadFinishingWorkload,type FinishingWorkload} from '@/lib/workflow/finishing-workload';

export default async function FinishingDatabasePage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const context=await getSessionContext();if(!can(context.role,'read','production'))redirect('/dashboard');
  let data:FinishingWorkload|null=null,options:ReturnType<typeof getFinishingWorkloadOptions>|null=null;
  try{options=getFinishingWorkloadOptions(await searchParams);data=await loadFinishingWorkload(await createClient(),context.companyId,options);}catch{/* Failed reads do not establish an empty database. */}
  return <div className="space-y-6"><Link href="/production/finishing" className="text-sm font-semibold text-slate-500 hover:text-orange">Back to Finishing Board</Link>
    <PageHeader title="Finishing Database" description="Search every original and corrective receipt. Quantities are retained as recorded; remaining rejection excludes material already transferred to a retry."/>
    {options?<form action="/production/finishing/database" className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4">
      {options.orderId?<input type="hidden" name="order_id" value={options.orderId}/>:null}{options.productionJobId?<input type="hidden" name="production_job_id" value={options.productionJobId}/>:null}
      <label className="text-xs font-semibold text-slate-600">Search<input className="form-input mt-1 block" name="q" defaultValue={options.search} maxLength={100} placeholder="Order, production, vendor or remarks"/></label>
      <label className="text-xs font-semibold text-slate-600">Status<select name="status" defaultValue={options.status} className="form-input mt-1 block"><option value="">All statuses</option>{finishingStatuses.map(status=><option key={status} value={status}>{labelize(status)}</option>)}</select></label>
      <label className="text-xs font-semibold text-slate-600">Sort<select name="sort" defaultValue={options.sort} className="form-input mt-1 block">{finishingSorts.map(sort=><option key={sort} value={sort}>{labelize(sort)}</option>)}</select></label>
      <select aria-label="Sort direction" name="direction" defaultValue={options.direction} className="form-input w-auto"><option value="asc">Ascending</option><option value="desc">Descending</option></select>
      <button className="min-h-11 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white">Apply</button><Link href="/production/finishing/database" className="px-3 py-2 text-sm font-semibold text-slate-500">Clear</Link>
    </form>:null}
    {!data?<><ErrorState title="Finishing database is unavailable" description="The complete quantities, page and retry identities could not be verified."/><Link href={options?finishingWorkloadHref('/production/finishing/database',options):'/production/finishing/database'} className="text-sm font-semibold text-orange">Retry loading finishing database</Link></>:<>
      <Card><CardHeader><h2 className="section-title">{data.total_count.toLocaleString('en-IN')} matching receipts</h2><p className="mt-1 text-xs font-medium text-slate-500">Ten records per server page. Open a receipt for its movement and corrective retry details.</p></CardHeader>
        <CardContent className="p-0"><div className="overflow-x-auto"><table className="industrial-table min-w-[1120px]"><thead><tr><th>Order / Production</th><th>Receipt</th><th>Status</th><th>Vendor</th><th>Planned / Received</th><th>Input</th><th>Accepted</th><th>Recorded rejected</th><th>Remaining rejected</th><th>Corrective retry</th></tr></thead>
          <tbody>{data.rows.map(row=><tr key={row.id} className="relative hover:bg-slate-50"><td><Link href={`/production/finishing/${row.id}`} className="font-black text-slate-950 after:absolute after:inset-0 hover:text-orange">{row.order_number??'Order unavailable'} / {row.job_number??'Production unavailable'}</Link><p className="text-xs text-slate-500">{row.customer_name}</p></td>
            <td>{labelize(row.finishing_type)}<p className="text-xs text-slate-500">{row.retry_of_finishing_job_id?'Corrective retry':'Original receipt'}</p></td><td><Badge value={row.status}/></td><td>{row.vendor_name??'In-house / not assigned'}</td><td>{formatDate(row.planned_date)}<p className="text-xs text-slate-500">Received {formatDate(row.received_date)}</p></td>
            <td>{formatWeight(row.input_weight_kg)}</td><td>{row.output_weight_kg===null?'Not recorded':formatWeight(row.output_weight_kg)}</td><td>{row.rejection_weight_kg===null?'Not recorded':formatWeight(row.rejection_weight_kg)}</td><td>{formatWeight(row.remaining_rejected_kg)}</td><td>{row.corrective_retry?labelize(row.corrective_retry.status):row.can_retry?'Available':'None'}</td></tr>)}
          {!data.rows.length?<tr><td colSpan={10} className="px-4 py-12 text-center text-sm font-semibold text-slate-500">No finishing receipts match this search or status.</td></tr>:null}</tbody></table></div></CardContent></Card>
      <nav aria-label="Finishing pages" className="flex flex-wrap items-center justify-between gap-3 text-sm font-semibold text-slate-600"><p>Page {data.page} of {Math.max(1,Math.ceil(data.total_count/10))}</p><div className="flex gap-3">{data.page>1?<Link className="rounded-lg border px-3 py-2" href={finishingWorkloadHref('/production/finishing/database',options!,{page:data.page-1})}>Previous</Link>:null}{data.page*10<data.total_count?<Link className="rounded-lg border px-3 py-2" href={finishingWorkloadHref('/production/finishing/database',options!,{page:data.page+1})}>Next</Link>:null}</div></nav>
    </>}
  </div>;
}
