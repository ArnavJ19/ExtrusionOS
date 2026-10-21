import Link from 'next/link';
import {redirect} from 'next/navigation';
import {Card,CardHeader,CardContent} from '@/components/ui/card';
import {Badge} from '@/components/ui/badge';
import {ErrorState} from '@/components/ui/error-state';
import {PageHeader} from '@/components/layout/page-header';
import {FinishingWorkflowBoard} from '@/components/modules/finishing-workflow-board';
import {getSessionContext} from '@/lib/auth';
import {can} from '@/lib/auth/permissions';
import {createClient} from '@/lib/supabase/server';
import {formatDate,formatWeight} from '@/lib/utils/format';
import {getFinishingWorkloadOptions,loadFinishingWorkload,toFinishingWorkflowJob,type FinishingWorkload} from '@/lib/workflow/finishing-workload';
import {ErpControlPanel} from '@/components/modules/erp-control-panel';
import {finishingRejectControls} from '@/lib/workflow/erp-control-panels';

export default async function FinishingReceiptPage({params}:{params:Promise<{id:string}>}){
  const context=await getSessionContext();if(!can(context.role,'read','production'))redirect('/dashboard');
  const {id}=await params;let data:FinishingWorkload|null=null;
  try{data=await loadFinishingWorkload(await createClient(),context.companyId,getFinishingWorkloadOptions({},id));}catch{/* A missing or invalid receipt cannot be offered for movement. */}
  const row=data?.rows[0];
  const rejectControls=row?finishingRejectControls(context,{id,rejection_weight_kg:row.rejection_weight_kg}):[];
  return <div className="space-y-6"><Link href="/production/finishing/database" className="text-sm font-semibold text-slate-500 hover:text-orange">Back to Finishing Database</Link>
    {!data||!row?<><ErrorState title="Finishing receipt is unavailable" description="Its source, quantities and retry identity could not be verified."/><Link href={`/production/finishing/${encodeURIComponent(id)}`} className="text-sm font-semibold text-orange">Retry loading receipt</Link></>:<>
      <PageHeader title={`${row.order_number??'Order'} / ${row.job_number??'Production'}`} description={row.retry_of_finishing_job_id?'Corrective finishing receipt. The original source remains retained.':'Original finishing receipt. Corrective processing retains a separate receipt.'}/>
      <Card><CardHeader><h2 className="section-title">Recorded Receipt</h2><Badge value={row.status}/></CardHeader><CardContent className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {[['Input',formatWeight(row.input_weight_kg)],['Accepted',row.output_weight_kg===null?'Not recorded':formatWeight(row.output_weight_kg)],['Recorded rejected',row.rejection_weight_kg===null?'Not recorded':formatWeight(row.rejection_weight_kg)],['Remaining rejected',formatWeight(row.remaining_rejected_kg)],['Vendor',row.vendor_name??'In-house / not assigned'],['Sent',formatDate(row.sent_date)],['Received',formatDate(row.received_date)],['Remarks',row.remarks??'No remarks']].map(([label,value])=><div key={label} className="min-w-0"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 break-words text-sm font-semibold text-slate-950">{value}</p></div>)}
      </CardContent></Card>
      <div className="flex flex-wrap gap-3">{row.retry_of_finishing_job_id?<Link href={`/production/finishing/${row.retry_of_finishing_job_id}`} className="text-sm font-semibold text-orange">Open rejected source</Link>:null}{row.corrective_retry?<Link href={`/production/finishing/${row.corrective_retry.id}`} className="text-sm font-semibold text-orange">Open corrective retry</Link>:null}<Link href={`/production/finishing?production_job_id=${row.production_job_id}`} className="text-sm font-semibold text-orange">View production finishing balance</Link></div>
      {['completed','not_required'].includes(row.status)?<p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-600">This terminal receipt is retained as evidence. Accepted finishing output still requires separate QC and packaging release.</p>:<Card><CardHeader><h2 className="section-title">Finishing Movement</h2></CardHeader><CardContent><FinishingWorkflowBoard key={`${row.id}:${row.updated_at}:${row.corrective_retry?.id??''}`} jobs={[toFinishingWorkflowJob(row)]} vendors={data.vendors} canUpdate={can(context.role,'update','production')}/></CardContent></Card>}
      <ErpControlPanel title='Finishing rejects' actions={rejectControls}/>
    </>}
  </div>;
}
