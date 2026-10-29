"use client";
import { useEffect,useRef,useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { workstationAction,switchWorkstationOperatorAction } from "@/lib/actions/workstation";
import { stationPreferenceKey,workstationExpired,type WorkstationResult } from "@/lib/workflow/workstation";
import { dispatchDraftKey } from "@/lib/forms/dispatch-draft";
type Station=Extract<WorkstationResult,{kind:"stations"}>["items"][number];
type Session=Extract<WorkstationResult,{kind:"session"}>;
type Queue=Extract<WorkstationResult,{kind:"queue"}>;
export function Workstation({companyId,userId,operatorName}:{companyId:string;userId:string;operatorName:string}){
  const router=useRouter(),[stations,setStations]=useState<Station[]>([]),[machine,setMachine]=useState("");
  const [session,setSession]=useState<Session|null>(null),[queue,setQueue]=useState<Queue|null>(null),[message,setMessage]=useState("");
  const [page,setPage]=useState(1),[search,setSearch]=useState(""),[locked,setLocked]=useState(false),[pending,setPending]=useState(false);
  const identity=useRef(crypto.randomUUID()),requesting=useRef(false),currentLease=useRef<string|null>(null);
  useEffect(()=>{try{setMachine(localStorage.getItem(stationPreferenceKey(companyId))??"");}catch{/* Station preference is optional. */}},[companyId]);
  useEffect(()=>{let current=true;setStations([]);void workstationAction({command:"stations.list",page,search}).then(result=>{
    if(!current)return;if(result.success&&result.data.kind==="stations")setStations(result.data.items);else setMessage("Press choices could not be verified.");
  }).catch(()=>{if(current)setMessage("Press choices are unavailable.");});return()=>{current=false;};},[page,search]);
  useEffect(()=>{if(!session||locked)return;let current=true;
    async function load(){const result=await workstationAction({command:"station.queue",id:session!.id});
      if(!current||currentLease.current!==session!.id)return;
      if(result.success&&result.data.kind==="queue"){setQueue(result.data);setMessage("");}else{setQueue(null);setLocked(true);setMessage("Station session cannot be verified. Switch operator to sign in again.");}}
    void load().catch(()=>{if(current){setQueue(null);setLocked(true);setMessage("Station connection was lost. Identify the operator again.");}});
    const polling=setInterval(()=>{void load().catch(()=>{if(current){setQueue(null);setLocked(true);}});},30000);
    const expiry=setInterval(()=>{if(workstationExpired(session.expires_at)){setQueue(null);setLocked(true);setMessage("Station session expired. Switch operator to sign in again.");}},1000);
    return()=>{current=false;clearInterval(polling);clearInterval(expiry);};},[session,locked]);
  async function open(){if(requesting.current||locked)return;requesting.current=true;setPending(true);setQueue(null);setMessage("");
    try{const result=await workstationAction({command:"station.open",id:identity.current,machine_id:machine});
      if(result.success&&result.data.kind==="session"&&result.data.operator_id===userId){currentLease.current=result.data.id;setSession(result.data);try{localStorage.setItem(stationPreferenceKey(companyId),machine);}catch{/* Optional preference. */}}
      else setMessage("The press session could not be opened for this operator.");
    }catch{setMessage("Station opening is uncertain. Retry with the same identity.");}finally{requesting.current=false;setPending(false);}}
  async function switchOperator(){if(requesting.current)return;requesting.current=true;setLocked(true);setQueue(null);currentLease.current=null;setMessage("Locking station and signing out...");
    try{try{localStorage.removeItem(dispatchDraftKey({companyId,userId}));}catch{/* The signed-out identity cannot restore another user's draft. */}
      if(session)await workstationAction({command:"station.end",id:session.id});
      const result=await switchWorkstationOperatorAction();if(result.success)router.replace("/login?next=%2Fproduction%2Fworkstation");else setMessage(result.error);
    }catch{setMessage("Sign-out could not be confirmed. This station remains locked.");}finally{requesting.current=false;}}
  return <div className="mx-auto max-w-4xl space-y-5"><div className="rounded-3xl bg-slate-950 p-6 text-white"><h1 className="text-2xl font-black">Press workstation</h1><p className="mt-2">Operator: {operatorName}</p><p className="mt-1 text-sm text-slate-300">Each station session expires after 10 minutes. Work attribution follows the signed-in operator.</p></div>
    <Button type="button" variant="secondary" onClick={switchOperator}>Lock and switch operator</Button>
    {locked?<p role="alert" className="rounded-2xl border p-5">Station locked. Sign in again before viewing or opening work.</p>:!session?<section className="space-y-3 rounded-2xl border bg-white p-5"><label className="block">Find press<input aria-label="Find press" className="form-input mt-1" value={search} maxLength={80} onChange={e=>{setSearch(e.target.value);setPage(1);}}/></label>
      <label className="block">Station press<select aria-label="Station press" className="form-input mt-1" value={machine} onChange={e=>{setMachine(e.target.value);identity.current=crypto.randomUUID();}}><option value="">Select press</option>{stations.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <div className="flex flex-wrap gap-3"><Button type="button" variant="ghost" disabled={page===1} onClick={()=>setPage(p=>p-1)}>Previous presses</Button><span>Page {page}</span><Button type="button" variant="ghost" disabled={stations.length<10} onClick={()=>setPage(p=>p+1)}>Next presses</Button></div>
      <Button type="button" disabled={pending||!stations.some(s=>s.id===machine)} onClick={open}>Identify operator and open station</Button></section>:<section aria-label="Station work queue" className="space-y-3"><h2 className="text-xl font-bold">{session.name}</h2>
      {queue?queue.items.length?queue.items.map(job=><Link href={`/production/${job.id}`} key={job.id} className="block rounded-2xl border bg-white p-4"><span className="font-bold">{job.job_number}</span><span className="block text-sm">{job.status.replaceAll("_"," ")} / {job.planned_quantity_kg??"Uncaptured"} kg</span><span className="mt-2 block font-semibold underline">Open guarded production workflow</span></Link>):<p>No queued jobs for this press.</p>:<p role="status">Checking current operator and press queue...</p>}
    </section>}
    {message?<p role="status" className="break-words text-sm">{message}</p>:null}
  </div>;
}
