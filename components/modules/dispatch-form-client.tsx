"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {z} from "zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, ScanLine, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { getDispatchSourcesAction, saveDispatchAction } from "@/lib/actions/dispatches";
import { createClient } from "@/lib/supabase/browser";
import { getBusinessDateBoundaries } from "@/lib/utils/business-date";
import { formatWeight } from "@/lib/utils/format";
import {readDispatchOrderOptions,readDispatchPreparationSources,readDispatchManifest,type DispatchPreparationSource} from "@/lib/dispatches/preparation";
import type { SessionContext } from "@/types/app";

type OrderOption = { value: string; label: string };
type SourceState = {orderId:string;status:"loading"|"ready"|"error";rows:DispatchPreparationSource[];error:string|null};
type OrderState = {search:string;status:"loading"|"ready"|"error";rows:OrderOption[];error:string|null};
type BundleRow = {
  key: string;
  bundle_number: string;
  source_line_id: string;
  number_of_pieces: string;
  net_length_m: string;
  gross_weight_kg: string;
  tare_weight_kg: string;
};

function newBundle(): BundleRow {
  return { key: crypto.randomUUID(), bundle_number: "", source_line_id: "", number_of_pieces: "", net_length_m: "", gross_weight_kg: "", tare_weight_kg: "" };
}

export function DispatchFormClient({ context }: { context: SessionContext }) {
  return <DispatchPreparationForm key={context.companyId} context={context} />;
}

function DispatchPreparationForm({context}:{context:SessionContext}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [orderState, setOrderState] = useState<OrderState>({search:"",status:"loading",rows:[],error:null});
  const [orderId, setOrderId] = useState("");
  const [orderSearch, setOrderSearch] = useState("");
  const [sourceState,setSourceState]=useState<SourceState|null>(null);
  const [orderRetry,setOrderRetry]=useState(0);
  const [sourceRetry,setSourceRetry]=useState(0);
  const [submitError,setSubmitError]=useState<string|null>(null);
  const [confirmationUnknown,setConfirmationUnknown]=useState(false);
  const [savedId,setSavedId]=useState<string|null>(null);
  const selectedOrderId=useRef("");
  const saving=useRef(false);
  const mounted=useRef(true);
  const [bundles, setBundles] = useState<BundleRow[]>([newBundle()]);
  const [dispatchDate, setDispatchDate] = useState(() => getBusinessDateBoundaries().today);
  const [transporterName, setTransporterName] = useState("");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [driverName, setDriverName] = useState("");
  const [driverPhone, setDriverPhone] = useState("");
  const [ewayBillNumber, setEwayBillNumber] = useState("");
  const [lrNumber, setLrNumber] = useState("");
  const [remarks, setRemarks] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);

  useEffect(() => {
    let cancelled=false;
    setOrderState({search:orderSearch,status:"loading",rows:[],error:null});
    const timer = setTimeout(async () => {
      try {
        if(orderSearch.length>100)throw new Error("Search too long");
        let query = supabase
        .from("orders_authorized")
        .select("id, order_number, customer_name, company_name, quote_number")
        .eq("company_id", context.companyId)
        .neq("current_stage", "cancelled")
        .order("order_date", { ascending: false })
        .order("id",{ascending:true})
        .limit(50);
        const search = orderSearch.trim().replace(/[^a-zA-Z0-9 _\-/]/g, "");
        if (search) query = query.or(`order_number.ilike.%${search}%,quote_number.ilike.%${search}%`);
        const {data,error}=await query;
        if(cancelled)return;
        if(error)throw error;
        setOrderState({search:orderSearch,status:"ready",rows:readDispatchOrderOptions(data),error:null});
      }catch{
        if(!cancelled)setOrderState({search:orderSearch,status:"error",rows:[],error:orderSearch.length>100?"Enter an order search of at most 100 characters.":"Order choices are unavailable. Retry the order search."});
      }
    }, 250);
    return () => {cancelled=true;clearTimeout(timer);};
  }, [context.companyId, orderSearch, orderRetry, supabase]);

  useEffect(() => {
    let cancelled=false;
    if(!orderId)return;
    setSourceState({orderId,status:"loading",rows:[],error:null});
    async function load(){
      try{
        const result=await getDispatchSourcesAction(orderId);
        if(cancelled||selectedOrderId.current!==orderId)return;
        if (!result.success) {
          setSourceState({orderId,status:"error",rows:[],error:result.error||"Dispatch sources are unavailable."});
          return;
        }
        setSourceState({orderId,status:"ready",rows:readDispatchPreparationSources(result),error:null});
      }catch{
        if(!cancelled&&selectedOrderId.current===orderId)setSourceState({orderId,status:"error",rows:[],error:"Could not verify dispatch sources. Retry the source check."});
      }
    }
    void load();
    return()=>{cancelled=true;};
  }, [orderId,sourceRetry]);

  const sourceReady=Boolean(orderId&&sourceState?.orderId===orderId&&sourceState.status==="ready");
  const sources=sourceReady?sourceState!.rows:[];
  const loadingSources=Boolean(orderId&&(!sourceState||sourceState.orderId!==orderId||sourceState.status==="loading"));
  const sourceError=sourceState?.orderId===orderId&&sourceState.status==="error"?sourceState.error:null;
  const searchingOrders=orderState.search!==orderSearch||orderState.status==="loading";
  const orders=orderState.search===orderSearch&&orderState.status==="ready"?orderState.rows:[];
  const orderError=orderState.search===orderSearch&&orderState.status==="error"?orderState.error:null;
  const locked=pending||confirmationUnknown||Boolean(savedId);

  function selectOrder(value:string){
    if(saving.current||locked||value===selectedOrderId.current)return;
    if(value&&!orders.some(order=>order.value===value))return;
    selectedOrderId.current=value;setOrderId(value);setSourceState(null);setBundles([newBundle()]);setSubmitError(null);
    if(!value)setOrderSearch("");
  }
  function searchOrders(search:string){
    if(saving.current||locked)return;
    selectedOrderId.current="";setOrderId("");setSourceState(null);setBundles([newBundle()]);setSubmitError(null);setOrderSearch(search);
  }
  function retrySources(){
    if(saving.current||locked||!orderId)return;
    setSourceState(null);setBundles([newBundle()]);setSubmitError(null);setSourceRetry(value=>value+1);
  }
  let manifestError:string|null=null;
  if(sourceReady){try{readDispatchManifest(sources,context.companyId,orderId,bundles);}catch(error){manifestError=error instanceof Error?error.message:"Check the bundle measurements.";}}
  const canSubmit=sourceReady&&sources.length>0&&!manifestError&&!locked;

  const sourceOptions = sources.map((source) => ({
    value: source.id,
    label: `${source.profileLabel} | ${source.sourceKind.replace(/_/g, " ")} ${source.sourceLabel} | ${formatWeight(source.availableWeightKg)}`
  }));
  const totals = bundles.reduce((sum, bundle) => {
    const gross = Number(bundle.gross_weight_kg || 0);
    const tare = Number(bundle.tare_weight_kg || 0);
    return { gross: sum.gross + gross, tare: sum.tare + tare, net: sum.net + Math.max(gross - tare, 0), pieces: sum.pieces + Number(bundle.number_of_pieces || 0) };
  }, { gross: 0, tare: 0, net: 0, pieces: 0 });

  function updateBundle(key: string, field: keyof Omit<BundleRow, "key">, value: string) {
    setBundles((current) => current.map((bundle) => bundle.key === key ? { ...bundle, [field]: value } : bundle));
  }

  function submit() {
    if(saving.current||locked)return;
    if(!sourceReady||selectedOrderId.current!==orderId)return setSubmitError("Select an order and wait for its current source check.");
    let verifiedBundles;
    try{verifiedBundles=readDispatchManifest(sources,context.companyId,orderId,bundles);}
    catch(error){setSubmitError(error instanceof Error?error.message:"Check the bundle measurements.");return;}
    saving.current=true;setSubmitError(null);
    startTransition(async () => {
      try{
        const result = await saveDispatchAction({
        order_id: orderId,
        dispatch_date: dispatchDate,
        transporter_name: transporterName,
        vehicle_number: vehicleNumber.toUpperCase(),
        driver_name: driverName,
        driver_phone: driverPhone,
        eway_bill_number: ewayBillNumber,
        lr_number: lrNumber,
        delivery_status: "dispatched",
        proof_of_delivery_url: "",
        packing_list_url: "",
        remarks,
        bundles: verifiedBundles
      });
        if(!mounted.current)return;
        if(result?.success===false){setSubmitError(result.error||"Could not record dispatch.");return;}
        const confirmation=z.object({success:z.literal(true),dispatchId:z.string().uuid()}).parse(result);
        setSavedId(confirmation.dispatchId);
        toast.success("Dispatch recorded from operator-verified physical bundles");
        router.push(`/dispatches/${confirmation.dispatchId}`);router.refresh();
      }catch{
        if(mounted.current){setConfirmationUnknown(true);setSubmitError("Dispatch confirmation could not be received. Check dispatch records before trying again.");}
      }finally{saving.current=false;}
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dispatches" className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-neutral-500 hover:text-neutral-950"><ArrowLeft className="h-4 w-4" /> Back to dispatches</Link>
        <h1 className="text-3xl font-black tracking-tight text-slate-950">Load Physical Dispatch</h1>
        <p className="mt-2 max-w-4xl text-sm font-medium leading-6 text-slate-500">Scan each bundle tag, select where that material physically came from, then enter the weighbridge gross, tare, and actual piece count. Stock is consumed from these rows only.</p>
      </div>

      <fieldset disabled={locked} className="min-w-0 space-y-6">
      <Card>
        <CardHeader><h2 className="section-title">Order and Vehicle</h2></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <label className="block space-y-1.5 md:col-span-2"><span className="form-label">Order *</span><SearchableSelect value={orderId} options={orders} onChange={selectOrder} onSearchChange={searchOrders} searching={searchingOrders} disabled={locked} emptyText={orderError?"Order choices unavailable":"No matching orders"} placeholder="Search order or customer PO" /></label>
          {orderError?<div role="alert" className="space-y-2 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 md:col-span-2 xl:col-span-3"><p>{orderError}</p><Button type="button" variant="secondary" onClick={()=>{setOrderState({search:orderSearch,status:"loading",rows:[],error:null});setOrderRetry(value=>value+1);}}>Retry order search</Button></div>:null}
          <label className="block space-y-1.5"><span className="form-label">Dispatch date *</span><input className="form-input" type="date" value={dispatchDate} onChange={(event) => setDispatchDate(event.target.value)} /></label>
          <label className="block space-y-1.5"><span className="form-label">Transporter</span><input className="form-input" value={transporterName} onChange={(event) => setTransporterName(event.target.value)} /></label>
          <label className="block space-y-1.5"><span className="form-label">Vehicle number</span><input className="form-input" value={vehicleNumber} onChange={(event) => setVehicleNumber(event.target.value.toUpperCase())} /></label>
          <label className="block space-y-1.5"><span className="form-label">Driver</span><input className="form-input" value={driverName} onChange={(event) => setDriverName(event.target.value)} /></label>
          <label className="block space-y-1.5"><span className="form-label">Driver phone</span><input className="form-input" value={driverPhone} onChange={(event) => setDriverPhone(event.target.value)} /></label>
          <label className="block space-y-1.5"><span className="form-label">E-way bill</span><input className="form-input" value={ewayBillNumber} onChange={(event) => setEwayBillNumber(event.target.value)} /></label>
          <label className="block space-y-1.5"><span className="form-label">LR number</span><input className="form-input" value={lrNumber} onChange={(event) => setLrNumber(event.target.value)} /></label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="section-title">Operator-Verified Bundle Manifest</h2><p className="mt-1 text-sm font-medium text-slate-500">One row must represent one tagged physical bundle loaded on the vehicle.</p></div><div className="flex flex-wrap gap-2">{sourceReady?<Button type="button" variant="secondary" onClick={retrySources}>Refresh sources</Button>:null}<Button type="button" variant="secondary" disabled={!sourceReady || !sources.length} onClick={() => setBundles((current) => [...current, newBundle()])}><Plus className="mr-2 h-4 w-4" /> Add bundle</Button></div></div></CardHeader>
        <CardContent className="space-y-4">
          {sourceError ? <div role="alert" className="space-y-2 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800"><p>{sourceError}</p><Button type="button" variant="secondary" onClick={retrySources}>Retry source check</Button></div> : null}
          {loadingSources ? <p className="text-sm font-semibold text-slate-500">Checking QC, finishing, packaging, reservations, and previously shipped quantities...</p> : null}
          {sourceReady&&!sources.length?<p className="text-sm text-slate-500">This order has no dispatch-ready material yet. Complete its stock or production handoffs, then refresh sources.</p>:null}
          {bundles.map((bundle, index) => {
            const selectedSource = sources.find((source) => source.id === bundle.source_line_id);
            const net = Math.max(Number(bundle.gross_weight_kg || 0) - Number(bundle.tare_weight_kg || 0), 0);
            return <div key={bundle.key} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4"><div className="mb-4 flex items-center justify-between"><p className="flex items-center gap-2 font-black text-slate-950"><ScanLine className="h-5 w-5 text-orange" /> Bundle {index + 1}</p>{bundles.length > 1 ? <button type="button" className="rounded-xl p-2 text-red-600 hover:bg-red-50" onClick={() => setBundles((current) => current.filter((row) => row.key !== bundle.key))} aria-label={`Remove bundle ${index + 1}`}><Trash2 className="h-4 w-4" /></button> : null}</div><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <label className="block space-y-1.5"><span className="form-label">Scan / Bundle ID *</span><input className="form-input font-mono font-bold uppercase" value={bundle.bundle_number} onChange={(event) => updateBundle(bundle.key, "bundle_number", event.target.value.toUpperCase())} /></label>
              <label className="block space-y-1.5 md:col-span-2"><span className="form-label">Exact material source *</span><SearchableSelect value={bundle.source_line_id} options={sourceOptions} disabled={!sourceReady || !sources.length || locked} onChange={(value) => updateBundle(bundle.key, "source_line_id", value)} placeholder="Select production job or stock batch" /></label>
              <label className="block space-y-1.5"><span className="form-label">Actual pieces *</span><input className="form-input" type="number" min="1" step="1" value={bundle.number_of_pieces} onChange={(event) => updateBundle(bundle.key, "number_of_pieces", event.target.value)} /></label>
              <label className="block space-y-1.5"><span className="form-label">Actual metres *</span><input className="form-input" type="number" min="0.001" step="0.001" value={bundle.net_length_m} onChange={(event) => updateBundle(bundle.key, "net_length_m", event.target.value)} /></label>
              <div className="rounded-xl border border-slate-200 bg-white px-3 py-2"><p className="text-[11px] font-black uppercase tracking-wider text-slate-400">Stock batch</p><p className="mt-1 text-sm font-bold text-slate-800">{selectedSource?.stockBatchLabel ?? (selectedSource ? "Production output" : "Select source")}</p></div>
              <label className="block space-y-1.5"><span className="form-label">Gross kg *</span><input className="form-input" type="number" min="0" step="0.001" value={bundle.gross_weight_kg} onChange={(event) => updateBundle(bundle.key, "gross_weight_kg", event.target.value)} /></label>
              <label className="block space-y-1.5"><span className="form-label">Tare kg *</span><input className="form-input" type="number" min="0" step="0.001" value={bundle.tare_weight_kg} onChange={(event) => updateBundle(bundle.key, "tare_weight_kg", event.target.value)} /></label>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2"><p className="text-[11px] font-black uppercase tracking-wider text-emerald-700">Measured net</p><p className="mt-1 text-lg font-black text-emerald-950">{formatWeight(net)}</p></div>
              <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 md:col-span-2"><p className="text-[11px] font-black uppercase tracking-wider text-slate-400">Remaining recorded stock</p><p className="mt-1 text-sm font-bold text-slate-800">{selectedSource ? `${formatWeight(selectedSource.availableWeightKg)} | ${selectedSource.availablePieces} pcs | ${selectedSource.availableLengthM.toFixed(3)} m` : "Select source"}</p></div>
            </div></div>;
          })}
          <div className="grid gap-3 rounded-2xl bg-slate-950 p-4 text-white sm:grid-cols-4"><Metric label="Bundles" value={String(bundles.length)} /><Metric label="Pieces" value={totals.pieces.toLocaleString("en-IN")} /><Metric label="Gross" value={formatWeight(totals.gross)} /><Metric label="Tare / Net" value={`${formatWeight(totals.tare)} / ${formatWeight(totals.net)}`} /></div>
        </CardContent>
      </Card>

      <Card><CardContent><label className="block space-y-1.5"><span className="form-label">Loading remarks</span><textarea className="form-input min-h-24" value={remarks} onChange={(event) => setRemarks(event.target.value)} /></label>
        {manifestError&&sources.length?<p className="mt-4 text-sm text-slate-600">{manifestError}</p>:null}
        {submitError?<div role="alert" className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><p>{submitError}</p>{confirmationUnknown?<Link href="/dispatches/database" className="mt-2 inline-block font-semibold underline">Check dispatch records</Link>:null}</div>:null}
        {savedId?<Link href={`/dispatches/${savedId}`} className="mt-4 inline-block text-sm font-semibold underline">View recorded dispatch</Link>:null}
        <div className="mt-5 flex justify-end"><Button type="button" disabled={!canSubmit} onClick={submit}>{pending ? "Verifying and posting stock..." : "Record verified dispatch"}</Button></div></CardContent></Card>
      </fieldset>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[11px] font-black uppercase tracking-wider text-slate-400">{label}</p><p className="mt-1 text-lg font-black">{value}</p></div>;
}
