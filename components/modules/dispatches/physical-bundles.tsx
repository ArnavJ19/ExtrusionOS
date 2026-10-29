"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getDispatchSourcesAction } from "@/lib/actions/dispatches";
import { listPhysicalBundlesAction,recordPhysicalBundleAction } from "@/lib/actions/physical-bundles";
import { readDispatchPreparationSources,type DispatchPreparationSource } from "@/lib/dispatches/preparation";
import { physicalBundleTag,type PhysicalBundle } from "@/lib/workflow/physical-bundles";
import { getBusinessDateBoundaries } from "@/lib/utils/business-date";

export function PreparedBundlePicker({orderId,onPick}:{orderId:string;onPick:(bundle:PhysicalBundle)=>void}){
  const [page,setPage]=useState(1),[search,setSearch]=useState(""),[retry,setRetry]=useState(0);
  const [state,setState]=useState<{items?:PhysicalBundle[];error?:string}>({});
  useEffect(()=>{let current=true;setState({});const timer=setTimeout(()=>{
    void listPhysicalBundlesAction({order_id:orderId,page,search}).then(result=>{if(current)setState(result.success?{items:result.data.items}:{error:result.error});})
      .catch(()=>{if(current)setState({error:"Prepared bundles are unavailable."});});
  },150);return()=>{current=false;clearTimeout(timer);};},[orderId,page,search,retry]);
  return <section aria-label="Prepared physical bundles" className="min-w-0 rounded-2xl border p-4 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-bold">Select bundles already measured</h2>
      <Link className="font-semibold underline" href={`/dispatches/bundles/new?order_id=${orderId}`}>Record a physical bundle</Link></div>
    <label className="mt-3 block">Find bundle tag<input className="form-input mt-1" value={search} maxLength={80} onChange={e=>{setSearch(e.target.value);setPage(1);}} /></label>
    {state.error?<div role="alert"><p>{state.error}</p><Button type="button" variant="secondary" onClick={()=>setRetry(value=>value+1)}>Retry prepared bundles</Button></div>
      :state.items?<div className="mt-3 space-y-2">{state.items.length?state.items.map(row=><div key={row.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 p-3">
        <p className="min-w-0 break-all">{row.bundle_number}<span className="block text-xs">{row.number_of_pieces} pcs / {row.net_length_m} m / {row.net_weight_kg} kg net</span></p>
        <Button type="button" variant="secondary" onClick={()=>onPick(row)}>Add measured bundle</Button></div>):<p>No unshipped measured bundles match this page.</p>}
        <div className="flex flex-wrap items-center gap-3"><Button type="button" variant="ghost" disabled={page===1} onClick={()=>setPage(p=>p-1)}>Previous bundles</Button><span>Page {page}</span><Button type="button" variant="ghost" disabled={state.items.length<10} onClick={()=>setPage(p=>p+1)}>Next bundles</Button></div>
      </div>:<p role="status" className="mt-3">Loading measured bundles...</p>}
    <p className="mt-2 text-xs text-slate-500">Preparation records observations. Dispatch rechecks current source availability and consumes each prepared bundle once.</p>
  </section>;
}

export function PhysicalBundleCapture({orderId}:{orderId:string}){
  const [sources,setSources]=useState<DispatchPreparationSource[]|null>(null),[sourceId,setSourceId]=useState("");
  const [identity,setIdentity]=useState(()=>crypto.randomUUID()),[tag,setTag]=useState("");
  const [pieces,setPieces]=useState(""),[length,setLength]=useState(""),[gross,setGross]=useState(""),[tare,setTare]=useState("");
  const [message,setMessage]=useState(""),[pending,setPending]=useState(false),[recorded,setRecorded]=useState(false),[retry,setRetry]=useState(0);
  const saving=useRef(false);
  useEffect(()=>{let current=true;setSources(null);void getDispatchSourcesAction(orderId).then(result=>{
    if(!current)return;if(!result.success){setMessage(result.error);return;}
    try{setSources(readDispatchPreparationSources(result));setMessage("");}catch{setMessage("Material sources could not be verified.");}
  }).catch(()=>{if(current)setMessage("Material sources are unavailable.");});return()=>{current=false;};},[orderId,retry]);
  const source=sources?.find(row=>row.id===sourceId),net=Number(gross)-Number(tare);
  async function save(){if(saving.current)return;saving.current=true;setPending(true);setMessage("");
    try{const result=await recordPhysicalBundleAction({id:identity,order_id:orderId,source_line_id:sourceId,bundle_number:tag,
      number_of_pieces:Number(pieces),net_length_m:Number(length),gross_weight_kg:Number(gross),tare_weight_kg:tare.trim()?Number(tare):NaN});
      if(result.success){setRecorded(true);setMessage("Bundle observations recorded. No stock has been consumed.");}else setMessage(result.error);
    }catch{setMessage("Confirmation is unavailable. Retry with the same bundle identity.");}finally{saving.current=false;setPending(false);}}
  return <div className="mx-auto max-w-2xl space-y-5"><h1 className="text-2xl font-black">Record a physical bundle</h1>
    <p className="text-sm text-slate-600">Select its released material, then enter the measurements observed on this bundle. Review net weight before recording.</p>
    <fieldset disabled={pending||recorded} className="min-w-0 space-y-4">
      <label className="block space-y-1">Material source<select aria-label="Material source" className="form-input min-h-12" value={sourceId} onChange={e=>setSourceId(e.target.value)}><option value="">{sources?"Choose released material":"Checking current sources..."}</option>{sources?.map(row=><option key={row.id} value={row.id}>{row.profileLabel} / {row.sourceLabel}</option>)}</select></label>
      {source?<p className="rounded-xl bg-slate-50 p-3 text-sm">{source.stockBatchLabel||source.sourceLabel}: up to {source.availablePieces} pcs / {source.availableLengthM} m / {source.availableWeightKg} kg, subject to confirmation.</p>:null}
      <label className="block space-y-1">Bundle tag<input className="form-input min-h-12" aria-label="Bundle tag" maxLength={80} value={tag} onChange={e=>setTag(e.target.value)} /></label>
      <Button type="button" variant="secondary" onClick={()=>setTag(physicalBundleTag(getBusinessDateBoundaries().today,identity))}>Generate bundle tag</Button>
      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">{[
        ["Actual pieces",pieces,setPieces,"numeric"],["Actual metres",length,setLength,"decimal"],["Gross kg",gross,setGross,"decimal"],["Tare kg",tare,setTare,"decimal"],
      ].map(([label,value,setter,mode])=><label key={String(label)} className="block space-y-1">{String(label)}<input aria-label={String(label)} className="form-input min-h-12" inputMode={mode as "numeric"|"decimal"} value={String(value)} onChange={e=>(setter as (s:string)=>void)(e.target.value)} /></label>)}</div>
      <p aria-live="polite" className="rounded-2xl bg-slate-900 p-4 text-lg font-bold text-white">Net weight: {gross.trim()&&tare.trim()&&Number.isFinite(net)&&net>0?`${net.toFixed(3)} kg`:"Enter valid gross and tare observations"}</p>
      <Button type="button" className="min-h-12 w-full" disabled={!source||!pieces.trim()||!length.trim()||!gross.trim()||!tare.trim()} onClick={save}>{pending?"Recording observations...":"Record measured bundle"}</Button>
    </fieldset>
    {message?<p role="status" className="break-words rounded-xl border p-3 text-sm">{message}</p>:null}
    {!sources?<Button type="button" variant="secondary" onClick={()=>setRetry(v=>v+1)}>Retry material sources</Button>:null}
    {recorded?<Button type="button" variant="secondary" onClick={()=>{setIdentity(crypto.randomUUID());setTag("");setPieces("");setLength("");setGross("");setTare("");setRecorded(false);setRetry(v=>v+1);}}>Record next bundle</Button>:null}
    <Link href={`/dispatches/new?order_id=${orderId}`} className="block font-semibold underline">Prepare dispatch from measured bundles</Link>
  </div>;
}
