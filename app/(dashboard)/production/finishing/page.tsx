import Link from 'next/link';
import {ArrowLeft} from 'lucide-react';
import {Card,CardContent,CardHeader} from '@/components/ui/card';
import {PageHeader} from '@/components/layout/page-header';
import {ErrorState} from '@/components/ui/error-state';
import {FinishingWorkflowBoard} from '@/components/modules/finishing-workflow-board';
import {createClient} from '@/lib/supabase/server';
import {getSessionContext} from '@/lib/auth';
import {can} from '@/lib/auth/permissions';
import {formatWeight} from '@/lib/utils/format';
import {labelize} from '@/types/app';
import {finishingAttentionStatuses,finishingStatuses,finishingWorkloadHref,getFinishingWorkloadOptions,loadFinishingWorkload,toFinishingWorkflowJob,type FinishingWorkload} from '@/lib/workflow/finishing-workload';
import {redirect} from 'next/navigation';

export default async function ProductionFinishingPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const context=await getSessionContext();if(!can(context.role,'read','production'))redirect('/dashboard');
  let data:FinishingWorkload|null=null,options:ReturnType<typeof getFinishingWorkloadOptions>|null=null;
  try{options=getFinishingWorkloadOptions(await searchParams);data=await loadFinishingWorkload(await createClient(),context.companyId,options);}catch{/* Unverified reads cannot establish zero work or safe retry eligibility. */}
  const databaseHref=options?finishingWorkloadHref('/production/finishing/database',options):'/production/finishing/database';
  const workflowRows=data?finishingAttentionStatuses.flatMap(status=>data.queues[status]).map(toFinishingWorkflowJob):[];
  return <div className="space-y-6">
    <div><Link href="/production" className="mb-3 inline-flex items-center gap-2 text-sm font-black text-slate-500 hover:text-orange"><ArrowLeft className="h-4 w-4"/> Back to Production</Link>
      <PageHeader title="Finishing Board" description="Follow accepted receipts, pending processing and rejected material through original and corrective finishing."/>
      <Link href={databaseHref} className="mt-4 inline-flex rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">View Finishing Database</Link></div>
    {!data?<><ErrorState title="Finishing workload is unavailable" description="Quantities and corrective retry links could not be verified. No empty-workload or retry-eligibility conclusion is available."/>
      <Link href={options?finishingWorkloadHref('/production/finishing',options):'/production/finishing'} className="text-sm font-semibold text-orange">Retry loading finishing workload</Link></>:<>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Active movements" value={data.summary.active_count.toLocaleString('en-IN')} detail="Planned, sent, processing or awaiting final disposition"/>
        <Metric label="Pending processing" value={formatWeight(data.summary.pending_input_kg)} detail={`${formatWeight(data.summary.at_vendor_input_kg)} sent or in process`}/>
        <Metric label="Remaining rejected" value={formatWeight(data.summary.remaining_rejected_kg)} detail="Recorded rejected material not transferred to a corrective retry"/>
        <Metric label="Accepted receipts" value={formatWeight(data.summary.accepted_output_kg)} detail="Final original and corrective receipts; QC and packaging release remain separate"/>
      </div>
      <Card><CardHeader><h2 className="section-title">Recorded Material Balance</h2></CardHeader><CardContent>
        <p className="text-sm font-semibold leading-6 text-slate-700">Original input {formatWeight(data.summary.original_input_kg)}. Corrective retry input is transferred material and is counted once in its current disposition.</p>
        <p className="mt-2 text-sm font-semibold leading-6 text-slate-700">Recorded difference: {formatWeight(data.summary.recorded_difference_kg)}. Not required: {formatWeight(data.summary.not_required_input_kg)}.</p>
        <p className="mt-2 text-xs font-medium leading-5 text-slate-500">These figures cover all {data.scope_count.toLocaleString('en-IN')} records in the selected order or production scope. A difference is unreconciled recorded weight; it does not establish physical process loss, gain or scrap.</p>
      </CardContent></Card>
      <Card><CardHeader><h2 className="section-title">Status Summary</h2><p className="mt-1 text-sm font-semibold text-slate-500">Counts retain every recorded status. Rejected receipts may already have a corrective retry.</p></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{finishingStatuses.map(status=><Link key={status} href={finishingWorkloadHref('/production/finishing/database',options!,{status,page:1})} className="rounded-2xl border border-slate-200 bg-white p-4 hover:border-orange/40">
          <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">{labelize(status)} receipts</p><p className="mt-2 text-2xl font-black text-slate-950">{data.status_counts[status].toLocaleString('en-IN')}</p></Link>)}</CardContent>
      </Card>
      <Card><CardHeader><h2 className="section-title">Update Finishing Movement</h2><p className="mt-1 text-sm font-semibold text-slate-500">Up to ten records per attention status are shown. Use the database for every record and its history.</p></CardHeader>
        <CardContent><FinishingWorkflowBoard key={`${data.company_id}:${data.order_id}:${data.production_job_id}:${workflowRows.map(row=>`${row.id}:${row.status}:${row.updated_at}`).join(',')}`} jobs={workflowRows} vendors={data.vendors} canUpdate={can(context.role,'update','production')} statusCounts={data.status_counts}/></CardContent>
      </Card>
    </>}
  </div>;
}

function Metric({label,value,detail}:{label:string;value:string;detail:string}){
  return <Card><CardContent><p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">{label}</p><p className="mt-2 break-words text-2xl font-black tabular-nums text-slate-950">{value}</p><p className="mt-2 text-xs font-medium leading-5 text-slate-500">{detail}</p></CardContent></Card>;
}
