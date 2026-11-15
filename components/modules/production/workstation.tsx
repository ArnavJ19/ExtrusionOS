"use client";
import { useEffect,useRef,useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { workstationAction,switchWorkstationOperatorAction } from "@/lib/actions/workstation";
import { stationPreferenceKey,workstationExpired,type WorkstationResult } from "@/lib/workflow/workstation";
import { dispatchDraftKey } from "@/lib/forms/dispatch-draft";
import { PressStation } from "@/components/modules/press/press-station";
import { FloorLanguageToggle } from "@/components/modules/autopilot-batch9/floor-language";
import { floorText, type FloorLanguage } from "@/lib/i18n/floor";
type Station=Extract<WorkstationResult,{kind:"stations"}>["items"][number];
type Session=Extract<WorkstationResult,{kind:"session"}>;
type Queue=Extract<WorkstationResult,{kind:"queue"}>;
export function Workstation({companyId,userId,operatorName,today,lang="en"}:{companyId:string;userId:string;operatorName:string;today:string;lang?:FloorLanguage}){
  const t=floorText(lang),router=useRouter(),[stations,setStations]=useState<Station[]>([]),[machine,setMachine]=useState("");
  const [session,setSession]=useState<Session|null>(null),[queue,setQueue]=useState<Queue|null>(null),[message,setMessage]=useState("");
  const [page,setPage]=useState(1),[search,setSearch]=useState(""),[locked,setLocked]=useState(false),[pending,setPending]=useState(false);
  const identity=useRef(crypto.randomUUID()),requesting=useRef(false),currentLease=useRef<string|null>(null);
  useEffect(()=>{try{setMachine(localStorage.getItem(stationPreferenceKey(companyId))??"");}catch{/* Station preference is optional. */}},[companyId]);
  useEffect(()=>{let current=true;setStations([]);void workstationAction({command:"stations.list",page,search}).then(result=>{
    if(!current)return;if(result.success&&result.data.kind==="stations")setStations(result.data.items);else setMessage(t("ws.choicesFailed"));
  }).catch(()=>{if(current)setMessage(t("ws.choicesUnavailable"));});return()=>{current=false;};},[page,search]);
  useEffect(()=>{if(!session||locked)return;let current=true;
    async function load(){const result=await workstationAction({command:"station.queue",id:session!.id});
      if(!current||currentLease.current!==session!.id)return;
      if(result.success&&result.data.kind==="queue"){setQueue(result.data);setMessage("");}else{setQueue(null);setLocked(true);setMessage(t("ws.sessionUnverified"));}}
    void load().catch(()=>{if(current){setQueue(null);setLocked(true);setMessage(t("ws.connectionLost"));}});
    const polling=setInterval(()=>{void load().catch(()=>{if(current){setQueue(null);setLocked(true);}});},30000);
    const expiry=setInterval(()=>{if(workstationExpired(session.expires_at)){setQueue(null);setLocked(true);setMessage(t("ws.expired"));}},1000);
    return()=>{current=false;clearInterval(polling);clearInterval(expiry);};},[session,locked]);
  async function open(){if(requesting.current||locked)return;requesting.current=true;setPending(true);setQueue(null);setMessage("");
    try{const result=await workstationAction({command:"station.open",id:identity.current,machine_id:machine});
      if(result.success&&result.data.kind==="session"&&result.data.operator_id===userId){currentLease.current=result.data.id;setSession(result.data);try{localStorage.setItem(stationPreferenceKey(companyId),machine);}catch{/* Optional preference. */}}
      else setMessage(t("ws.openFailed"));
    }catch{setMessage(t("ws.openUncertain"));}finally{requesting.current=false;setPending(false);}}
  async function switchOperator(){if(requesting.current)return;requesting.current=true;setLocked(true);setQueue(null);currentLease.current=null;setMessage(t("ws.locking"));
    try{try{localStorage.removeItem(dispatchDraftKey({companyId,userId}));}catch{/* The signed-out identity cannot restore another user's draft. */}
      if(session)await workstationAction({command:"station.end",id:session.id});
      const result=await switchWorkstationOperatorAction();if(result.success)router.replace("/login?next=%2Fproduction%2Fworkstation");else setMessage(result.error);
    }catch{setMessage(t("ws.signoutFailed"));}finally{requesting.current=false;}}
  return <div className="mx-auto max-w-4xl space-y-5"><div className="rounded-3xl bg-slate-950 p-6 text-white"><div className="flex flex-wrap items-start justify-between gap-3"><h1 className="text-2xl font-black">{t("ws.title")}</h1><FloorLanguageToggle lang={lang} dark /></div><p className="mt-2">{t("ws.operator",{name:operatorName})}</p><p className="mt-1 text-sm text-slate-300">{t("ws.session")}</p></div>
    <Button type="button" variant="secondary" onClick={switchOperator}>{t("ws.lock")}</Button>
    {locked?<p role="alert" className="rounded-2xl border p-5">{t("ws.locked")}</p>:!session?<section className="space-y-3 rounded-2xl border bg-white p-5"><label className="block">{t("ws.find")}<input aria-label={t("ws.find")} className="form-input mt-1" value={search} maxLength={80} onChange={e=>{setSearch(e.target.value);setPage(1);}}/></label>
      <label className="block">{t("ws.press")}<select aria-label={t("ws.press")} className="form-input mt-1" value={machine} onChange={e=>{setMachine(e.target.value);identity.current=crypto.randomUUID();}}><option value="">{t("ws.select")}</option>{stations.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <div className="flex flex-wrap gap-3"><Button type="button" variant="ghost" disabled={page===1} onClick={()=>setPage(p=>p-1)}>{t("ws.prev")}</Button><span>{t("common.page",{n:page})}</span><Button type="button" variant="ghost" disabled={stations.length<10} onClick={()=>setPage(p=>p+1)}>{t("ws.next")}</Button></div>
      <Button type="button" disabled={pending||!stations.some(s=>s.id===machine)} onClick={open}>{t("ws.open")}</Button></section>:<section aria-label="Station work queue" className="space-y-3"><h2 className="text-xl font-bold">{session.name}</h2>
      <PressStation key={session.id} lang={lang} companyId={companyId} userId={userId} sessionId={session.id} today={today}
        onExpired={(text)=>{setQueue(null);setLocked(true);setMessage(text);}} onRenewed={(expiresAt)=>setSession(current=>current&&current.id===session.id&&current.expires_at!==expiresAt?{...current,expires_at:expiresAt}:current)}/>
      <h3 className="pt-2 text-lg font-bold">{t("ws.queue")}</h3>
      {queue?queue.items.length?queue.items.map(job=><Link href={`/production/${job.id}`} key={job.id} className="block rounded-2xl border bg-white p-4"><span className="font-bold">{job.job_number}</span><span className="block text-sm">{job.status.replaceAll("_"," ")} / {job.planned_quantity_kg??t("ws.uncaptured")} kg</span><span className="mt-2 block font-semibold underline">{t("ws.openJob")}</span></Link>):<p>{t("ws.noQueue")}</p>:<p role="status">{t("ws.checking")}</p>}
    </section>}
    {message?<p role="status" className="break-words text-sm">{message}</p>:null}
  </div>;
}
