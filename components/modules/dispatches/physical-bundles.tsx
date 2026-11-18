"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getDispatchSourcesAction } from "@/lib/actions/dispatches";
import { listPhysicalBundlesAction,recordPhysicalBundleAction } from "@/lib/actions/physical-bundles";
import { OfflineQueuePanel, bundleTransport, useOfflineQueueCore } from "@/components/modules/offline/offline-core";
const bundles=bundleTransport(recordPhysicalBundleAction);
import { readDispatchPreparationSources,type DispatchPreparationSource } from "@/lib/dispatches/preparation";
import { physicalBundleTag,type PhysicalBundle } from "@/lib/workflow/physical-bundles";
import { getBusinessDateBoundaries } from "@/lib/utils/business-date";
import { parseBundleObservationText } from "@/lib/workflow/mobile-bundle-task";
import { floorText, type FloorLanguage } from "@/lib/i18n/floor";
import { FloorLanguageToggle } from "@/components/modules/autopilot-batch9/floor-language";
import { ScaleCapture, type ScaleCaptureValue } from "@/components/modules/autopilot-batch9/scale-capture";

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

export function PhysicalBundleCapture({orderId,companyId="local",userId="local",lang="en"}:{orderId:string;companyId?:string;userId?:string;lang?:FloorLanguage}){
  // AP-094: a bundle recorded while the signal drops stays on this phone and is sent once, under the same bundle identity.
  // AP-010: the gross weight can come from the packing scale (marked "from scale"); typing it marks it as typed.
  // AP-095: labels follow the person's floor language.
  const t=floorText(lang);
  const queue=useOfflineQueueCore(companyId,userId,bundles);
  const [sources,setSources]=useState<DispatchPreparationSource[]|null>(null),[sourceId,setSourceId]=useState("");
  const [identity,setIdentity]=useState(()=>crypto.randomUUID()),[tag,setTag]=useState("");
  const [pieces,setPieces]=useState(""),[length,setLength]=useState(""),[gross,setGross]=useState(""),[tare,setTare]=useState("");
  const [scale,setScale]=useState<ScaleCaptureValue|null>(null),[check,setCheck]=useState<string|null>(null);
  const [message,setMessage]=useState(""),[pending,setPending]=useState(false),[recorded,setRecorded]=useState(false),[retry,setRetry]=useState(0);
  const saving=useRef(false);
  useEffect(()=>{let current=true;setSources(null);void getDispatchSourcesAction(orderId).then(result=>{
    if(!current)return;if(!result.success){setMessage(result.error);return;}
    try{setSources(readDispatchPreparationSources(result));setMessage("");}catch{setMessage(t("bd.sourcesFailed"));}
  }).catch(()=>{if(current)setMessage(t("bd.sourcesUnavailable"));});return()=>{current=false;};
  },[orderId,retry]);
  const source=sources?.find(row=>row.id===sourceId),net=Number(gross)-Number(tare);
  const fromScale=Boolean(scale&&gross===String(scale.kg));
  async function save(){if(saving.current)return;saving.current=true;setPending(true);setMessage("");setCheck(null);
    try{const capture=fromScale&&scale?{source:"scale",indicator_ref:scale.indicator,raw_reading:scale.raw,stable:true,readings_count:scale.readings}:{source:"manual"};
      const outcome=await queue.submit({kind:"bundle",rpc:"physical_bundle_command",command:"bundle.record",label:`Bundle ${tag}`,requestId:identity,payload:{id:identity,order_id:orderId,source_line_id:sourceId,bundle_number:tag,
      number_of_pieces:parseBundleObservationText(pieces,true),net_length_m:parseBundleObservationText(length),gross_weight_kg:parseBundleObservationText(gross),tare_weight_kg:parseBundleObservationText(tare),weight_capture:capture}});
      if(outcome.kind==="applied"){setRecorded(true);setMessage(t("bd.recorded"));
        const w=(outcome.data as {weight?:{flagged:boolean;deviation_percent:number|null;theoretical_kg:number|null;tolerance_percent:number|null}|null}|undefined)?.weight;
        if(w&&w.theoretical_kg!==null&&w.deviation_percent!==null)setCheck(w.flagged?t("bd.overTolerance",{pct:w.deviation_percent,theo:w.theoretical_kg}):w.tolerance_percent!==null?t("bd.withinTolerance",{tol:w.tolerance_percent,theo:w.theoretical_kg}):null);}
      else if(outcome.kind==="retry"){setRecorded(true);setMessage(t("bd.offline"));}
      else setMessage(outcome.message);
    }catch{setMessage(t("bd.unconfirmed"));}finally{saving.current=false;setPending(false);}}
  return <div className="mx-auto max-w-2xl space-y-5"><div className="flex flex-wrap items-start justify-between gap-3"><h1 className="text-2xl font-black">{t("bd.title")}</h1><FloorLanguageToggle lang={lang} /></div>
    <OfflineQueuePanel queue={queue} what={lang==="hi"?"बंडल":"bundle(s)"} place={lang==="hi"?"फ़ोन":"phone"} lang={lang} />
    <p className="text-sm text-slate-600">{t("bd.help")}</p>
    <fieldset disabled={pending||recorded} className="min-w-0 space-y-4">
      <label className="block space-y-1">{t("bd.source")}<select aria-label={t("bd.source")} className="form-input min-h-12" value={sourceId} onChange={e=>setSourceId(e.target.value)}><option value="">{sources?t("bd.choose"):t("bd.checking")}</option>{sources?.map(row=><option key={row.id} value={row.id}>{row.profileLabel} / {row.sourceLabel}</option>)}</select></label>
      {source?<p className="rounded-xl bg-slate-50 p-3 text-sm">{t("bd.upTo",{label:source.stockBatchLabel||source.sourceLabel,pcs:source.availablePieces,m:source.availableLengthM,kg:source.availableWeightKg})}</p>:null}
      <label className="block space-y-1">{t("bd.tag")}<input className="form-input min-h-12" aria-label={t("bd.tag")} maxLength={80} value={tag} onChange={e=>setTag(e.target.value)} /></label>
      <Button type="button" variant="secondary" onClick={()=>setTag(physicalBundleTag(getBusinessDateBoundaries().today,identity))}>{t("bd.generate")}</Button>
      <ScaleCapture lang={lang} disabled={pending||recorded} onCapture={value=>{setScale(value);setGross(String(value.kg));setMessage(t("sc.captured",{kg:value.kg}));}} />
      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">{([
        ["bd.pieces",pieces,setPieces,"numeric"],["bd.metres",length,setLength,"decimal"],["bd.gross",gross,setGross,"decimal"],["bd.tare",tare,setTare,"decimal"],
      ] as const).map(([key,value,setter,mode])=><label key={key} className="block space-y-1"><span className="flex flex-wrap items-center gap-2">{t(key)}{key==="bd.gross"&&gross.trim()?<span className={`rounded-full px-2 py-0.5 text-xs font-bold ${fromScale?"bg-emerald-100 text-emerald-900":"bg-neutral-100 text-neutral-700"}`}>{fromScale?t("bd.fromScale"):t("bd.typed")}</span>:null}</span>
        <input aria-label={t(key)} className="form-input min-h-12" inputMode={mode} value={value} onChange={e=>setter(e.target.value)} /></label>)}</div>
      <p aria-live="polite" className="rounded-2xl bg-slate-900 p-4 text-lg font-bold text-white">{gross.trim()&&tare.trim()&&Number.isFinite(net)&&net>0?t("bd.net",{kg:net.toFixed(3)}):t("bd.netInvalid")}</p>
      <Button type="button" className="min-h-12 w-full" disabled={!source||!pieces.trim()||!length.trim()||!gross.trim()||!tare.trim()} onClick={save}>{pending?t("bd.recording"):t("bd.record")}</Button>
    </fieldset>
    {message?<p role="status" className="break-words rounded-xl border p-3 text-sm">{message}</p>:null}
    {check?<p role="status" className={`break-words rounded-xl p-3 text-sm font-semibold ${/from theoretical|से .*% अलग/.test(check)?"bg-amber-50 text-amber-900":"bg-emerald-50 text-emerald-900"}`}>{check}</p>:null}
    {!sources?<Button type="button" variant="secondary" onClick={()=>setRetry(v=>v+1)}>{t("bd.retrySources")}</Button>:null}
    {recorded?<Button type="button" variant="secondary" onClick={()=>{setIdentity(crypto.randomUUID());setTag("");setPieces("");setLength("");setGross("");setTare("");setScale(null);setCheck(null);setRecorded(false);setRetry(v=>v+1);}}>{t("bd.next")}</Button>:null}
    <Link href={`/dispatches/new?order_id=${orderId}`} className="block font-semibold underline">{t("bd.toDispatch")}</Link>
  </div>;
}
