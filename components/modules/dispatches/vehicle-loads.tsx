"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  getFactoryVehicleLoadSnapshotAction,
  saveFactoryVehicleAction,
  releaseFactoryVehicleLoadBundlesAction,
  saveFactoryVehicleLoadAction
} from "@/lib/actions/factory-planning";
import { factoryVehicleLoadWeight, type FactoryVehicleLoadSnapshot } from "@/lib/workflow/factory-planning";
import { formatWeight } from "@/lib/utils/format";

type Bundle = FactoryVehicleLoadSnapshot["bundles"][number];

function businessDate() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = (name: string) => parts.find(part => part.type === name)?.value ?? "00";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function selectedFromLoad(snapshot: FactoryVehicleLoadSnapshot): Record<string, Bundle> {
  return Object.fromEntries((snapshot.current_load?.items ?? []).filter(item => item.status === "active").map(item => [item.id, item]));
}

export function VehicleLoads({ initialSnapshot, initialError, canConfigure }: {
  initialSnapshot: FactoryVehicleLoadSnapshot | null;
  initialError: string | null;
  canConfigure: boolean;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [error, setError] = useState(initialError);
  const [pending, startTransition] = useTransition();
  const [loadId, setLoadId] = useState<string | null>(initialSnapshot?.current_load?.id ?? null);
  const [vehicleId, setVehicleId] = useState(initialSnapshot?.current_load?.vehicle_id ?? initialSnapshot?.vehicles[0]?.id ?? "");
  const [loadDate, setLoadDate] = useState(initialSnapshot?.current_load?.load_date ?? businessDate());
  const [selected, setSelected] = useState<Record<string, Bundle>>(() => initialSnapshot ? selectedFromLoad(initialSnapshot) : {});
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [registration, setRegistration] = useState("");
  const [label, setLabel] = useState("");
  const [vehicleCapacity, setVehicleCapacity] = useState("");
  const [savingVehicle, setSavingVehicle] = useState(false);
  const requestRef = useRef<{ key: string; id: string } | null>(null);
  const releaseRequestRef=useRef<{key:string;id:string}|null>(null);
  const [releaseReason,setReleaseReason]=useState("");

  const currentVehicle = snapshot?.vehicles.find(vehicle => vehicle.id === vehicleId);
  const selectedBundles = Object.values(selected);
  const selectedWeight = factoryVehicleLoadWeight(selectedBundles);
  const currentLoad = snapshot?.current_load ?? null;
  const mayEdit = !currentLoad || currentLoad.status === "reviewed";
  const overCapacity = Boolean(currentVehicle && selectedWeight > currentVehicle.capacity_kg + 0.001);

  async function reload(input: { load_id?: string | null; page?: number; search?: string } = {}) {
    const result = await getFactoryVehicleLoadSnapshotAction({
      load_id: input.load_id === undefined ? loadId : input.load_id,
      page: input.page ?? page,
      search: input.search ?? search
    });
    if (result.success) {
      setSnapshot(result.data);
      setError(null);
      return result.data;
    }
    setError(result.error);
    return null;
  }

  function selectLoad(id: string) {
    startTransition(async () => {
      const data = await getFactoryVehicleLoadSnapshotAction({ load_id: id, page: 1, search });
      if (!data.success) return setError(data.error);
      setSnapshot(data.data);
      setLoadId(id);
      setVehicleId(data.data.current_load?.vehicle_id ?? "");
      setLoadDate(data.data.current_load?.load_date ?? businessDate());
      setSelected(selectedFromLoad(data.data));
      setPage(1);
      setError(null);
    });
  }

  function startNewLoad() {
    startTransition(async () => {
      const data = await getFactoryVehicleLoadSnapshotAction({ load_id: null, page: 1, search });
      if (!data.success) return setError(data.error);
      setSnapshot(data.data);
      setLoadId(null);
      setVehicleId(data.data.vehicles[0]?.id ?? "");
      setLoadDate(businessDate());
      setSelected({});
      requestRef.current = null;
      setError(null);
    });
  }

  function toggleBundle(bundle: Bundle) {
    setSelected(current => {
      const next = { ...current };
      if (next[bundle.id]) delete next[bundle.id];
      else next[bundle.id] = bundle;
      return next;
    });
    requestRef.current = null;
  }

  async function addVehicle(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const savedRegistration = registration.trim().toUpperCase();
    setSavingVehicle(true);
    const result = await saveFactoryVehicleAction({ registration_number: registration, vehicle_label: label, capacity_kg: Number(vehicleCapacity) });
    setSavingVehicle(false);
    if (!result.success) return setError(result.error);
    setRegistration(""); setLabel(""); setVehicleCapacity("");
    const refreshed = loadId ? await getFactoryVehicleLoadSnapshotAction({ load_id: loadId, page, search }) : null;
    const next = refreshed?.success ? refreshed.data : {
      ...result.data,
      bundles: snapshot?.bundles ?? result.data.bundles,
      loads: snapshot?.loads ?? result.data.loads,
      load_total_count: snapshot?.load_total_count ?? result.data.load_total_count,
      current_load: snapshot?.current_load ?? null
    };
    setSnapshot(next);
    setVehicleId(next.vehicles.find(row => row.registration_number === savedRegistration)?.id ?? next.vehicles[0]?.id ?? "");
    setError(refreshed && !refreshed.success ? "Vehicle capacity was saved; refresh the open load before continuing." : null);
    toast.success("Vehicle capacity saved.");
  }

  function saveLoad() {
    if (!snapshot || !currentVehicle) return setError("Configure or select an active vehicle before reviewing the load.");
    if (overCapacity) return setError("Remove bundles until the load is within the selected vehicle capacity.");
    const base = {
      load_id: loadId, expected_version: currentLoad?.version ?? 0, vehicle_id: vehicleId,
      vehicle_fingerprint: currentVehicle.fingerprint, load_date: loadDate,
      bundles: selectedBundles.map(bundle => ({ id: bundle.id, fingerprint: bundle.fingerprint })).sort((a, b) => a.id.localeCompare(b.id))
    };
    const key = JSON.stringify(base);
    if (!requestRef.current || requestRef.current.key !== key) requestRef.current = { key, id: crypto.randomUUID() };
    const payload = { ...base, request_id: requestRef.current.id };
    startTransition(async () => {
      setError(null);
      const result = await saveFactoryVehicleLoadAction(payload);
      if (!result.success) {
        setError(result.error);
        await reload();
        return;
      }
      requestRef.current = null;
      setLoadId(result.load.id);
      toast.success(result.replayed ? "The same vehicle-load review was already recorded." : "Vehicle load reviewed and saved.");
      const next = await getFactoryVehicleLoadSnapshotAction({ load_id: result.load.id, page, search });
      if (next.success) {
        setSnapshot(next.data);
        setSelected(selectedFromLoad(next.data));
        setVehicleId(next.data.current_load?.vehicle_id ?? vehicleId);
        setLoadDate(next.data.current_load?.load_date ?? loadDate);
      } else setError(next.error);
    });
  }

  function releaseSavedBundle(bundle:Bundle){
    if(!currentLoad)return;
    const base={load_id:currentLoad.id,expected_version:currentLoad.version,bundle_ids:[bundle.id],reason:releaseReason};
    const key=JSON.stringify(base);if(!releaseRequestRef.current||releaseRequestRef.current.key!==key)releaseRequestRef.current={key,id:crypto.randomUUID()};
    const payload={...base,request_id:releaseRequestRef.current.id};
    startTransition(async()=>{try{const r=await releaseFactoryVehicleLoadBundlesAction(payload);if(!r.success){setError(r.error);return;}
      releaseRequestRef.current=null;const data=await reload({load_id:currentLoad.id});if(data)setSelected(selectedFromLoad(data));setReleaseReason("");toast.success("Saved bundle assignment released; stock movements are unchanged.");
    }catch{setError("Release confirmation is uncertain. Retry the same release or reload the saved load.");}});
  }

  if (!snapshot) return <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm font-semibold text-amber-900">{error ?? "Vehicle loads could not be loaded."}</div>;

  return (
    <div className="space-y-6">
      {error ? <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">{error}</div> : null}

      {canConfigure ? <details className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <summary className="cursor-pointer font-black text-slate-950">Configure vehicle capacity</summary>
        <form onSubmit={addVehicle} className="mt-4 grid gap-3 md:grid-cols-4">
          <label className="space-y-1"><span className="form-label">Registration number</span><input className="form-input" value={registration} onChange={event => setRegistration(event.target.value)} maxLength={30} required disabled={savingVehicle} /></label>
          <label className="space-y-1"><span className="form-label">Vehicle label</span><input className="form-input" value={label} onChange={event => setLabel(event.target.value)} maxLength={80} placeholder="12T open body" required disabled={savingVehicle} /></label>
          <label className="space-y-1"><span className="form-label">Capacity (kg)</span><input className="form-input" type="number" min="0.001" max="1000000" step="0.001" value={vehicleCapacity} onChange={event => setVehicleCapacity(event.target.value)} required disabled={savingVehicle} /></label>
          <div className="flex items-end"><Button type="submit" disabled={savingVehicle}>{savingVehicle ? "Saving..." : "Save vehicle"}</Button></div>
        </form>
      </details> : null}

      <section className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,1fr)]">
        <div className="min-w-0 space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="section-title">Measured bundles</h2><p className="mt-1 text-sm font-medium text-slate-500">Only currently eligible, undispatched physical bundles are selectable. Each row keeps its original order, party, destination, source line, and document relationship.</p></div><Button type="button" variant="secondary" onClick={startNewLoad} disabled={pending}>New load</Button></div>
          <form className="flex gap-2" onSubmit={event => { event.preventDefault(); setPage(1); void reload({ load_id: loadId, page: 1, search }); }}>
            <label className="min-w-0 flex-1 space-y-1"><span className="form-label">Find order, customer, destination or bundle tag</span><input className="form-input" value={search} onChange={event => setSearch(event.target.value)} maxLength={80} /></label>
            <div className="flex items-end"><Button type="submit" variant="secondary" disabled={pending}>Search</Button></div>
          </form>
          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500"><tr><th className="p-3">Select</th><th className="p-3">Order / customer</th><th className="p-3">Measured bundle</th><th className="p-3">Destination / document</th><th className="p-3">Measured</th></tr></thead>
              <tbody>{snapshot.bundles.map(bundle => <tr key={bundle.id} className="border-t border-slate-100 align-top">
                <td className="p-3"><input type="checkbox" aria-label={`Select bundle ${bundle.bundle_number}`} checked={Boolean(selected[bundle.id])} onChange={() => toggleBundle(bundle)} disabled={!mayEdit || pending} /></td>
                <td className="p-3"><strong className="text-slate-950">{bundle.order_number}</strong><p className="mt-1 text-xs text-slate-600">{bundle.customer_name ?? "Customer unavailable"}</p><p className="mt-1 text-[11px] text-slate-500">{bundle.party_basis}</p></td>
                <td className="p-3"><strong>{bundle.bundle_number}</strong><p className="mt-1 text-xs text-slate-500">Profile {bundle.profile_id.slice(0, 8)} · source {bundle.source_kind}</p></td>
                <td className="p-3 text-xs text-slate-700">{bundle.destination ?? "Destination not recorded"}<p className="mt-1 text-slate-500">{bundle.source_document_quote_id ? `Quote ${bundle.source_document_quote_id.slice(0, 8)} · revision ${bundle.source_document_revision}` : "No quote revision snapshot"}</p></td>
                <td className="p-3 whitespace-nowrap text-xs font-semibold text-slate-700">{formatWeight(bundle.net_weight_kg)}<p>{bundle.number_of_pieces} pcs · {bundle.net_length_m.toFixed(3)} m</p></td>
              </tr>)}
              {!snapshot.bundles.length ? <tr><td colSpan={5} className="p-5 text-center text-sm text-slate-500">No eligible measured bundles match this search.</td></tr> : null}</tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-slate-500"><span>{snapshot.total_bundle_count} eligible bundles · page {snapshot.page} of {Math.max(1, Math.ceil(snapshot.total_bundle_count / 10))}</span><div className="flex gap-2"><Button type="button" variant="secondary" disabled={pending || page <= 1} onClick={() => { const next = page - 1; setPage(next); void reload({ page: next }); }}>Previous</Button><Button type="button" variant="secondary" disabled={pending || page * 10 >= snapshot.total_bundle_count} onClick={() => { const next = page + 1; setPage(next); void reload({ page: next }); }}>Next</Button></div></div>
        </div>

        <aside className="min-w-0 space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-2"><div><h2 className="section-title">Reviewed vehicle load</h2><p className="mt-1 text-xs text-slate-500">Save creates a reviewed plan. Dispatch remains a separate stock-consuming workflow.</p></div>{loadId ? <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-black uppercase text-emerald-800">Existing review</span> : <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase text-slate-600">Draft</span>}</div>
          <label className="block min-w-0 space-y-1"><span className="form-label">Vehicle</span><select className="form-input min-w-0 max-w-full" value={vehicleId} onChange={event => { setVehicleId(event.target.value); requestRef.current = null; }} disabled={pending || !mayEdit}><option value="">Choose a vehicle</option>{snapshot.vehicles.map(vehicle => <option key={vehicle.id} value={vehicle.id}>{vehicle.registration_number} · {vehicle.vehicle_label} · {formatWeight(vehicle.capacity_kg)}</option>)}</select></label>
          <label className="block space-y-1"><span className="form-label">Planned load date</span><input className="form-input" type="date" value={loadDate} min={businessDate()} onChange={event => { setLoadDate(event.target.value); requestRef.current = null; }} disabled={pending || !mayEdit} /></label>
          <div className="rounded-2xl bg-slate-950 p-4 text-white"><p className="text-xs font-bold uppercase tracking-wide text-slate-300">Planned weight</p><p className="mt-1 text-3xl font-black">{formatWeight(selectedWeight)}</p><p className="mt-1 text-xs text-slate-300">{selectedBundles.length} measured bundle{selectedBundles.length === 1 ? "" : "s"} · vehicle capacity {currentVehicle ? formatWeight(currentVehicle.capacity_kg) : "not configured"}</p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-700"><div className={`h-full ${overCapacity ? "bg-rose-400" : "bg-emerald-400"}`} style={{ width: `${currentVehicle ? Math.min(selectedWeight / currentVehicle.capacity_kg * 100, 100) : 0}%` }} /></div>
          </div>
          {overCapacity ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-xs font-bold text-rose-800">The selected bundles exceed the configured vehicle capacity.</p> : null}
          {currentLoad ? <div className="rounded-2xl border border-slate-200 p-3 text-xs text-slate-600"><p><strong>Load {currentLoad.id.slice(0, 8)}</strong> · version {currentLoad.version} · {currentLoad.status}</p><p className="mt-1">{currentLoad.item_count} active bundles · {formatWeight(currentLoad.total_weight_kg)} persisted</p></div> : null}
          {currentLoad ? <section className="space-y-3"><h3 className="font-semibold">Saved bundle assignments</h3><p className="text-xs text-slate-500">A saved assignment can be released even if its source is no longer eligible, its vehicle is inactive or the planned date has passed.</p><label className="block text-sm">Reason for releasing a saved bundle<textarea className="form-input mt-1" maxLength={1000} value={releaseReason} onChange={event=>setReleaseReason(event.target.value)} disabled={pending}/></label>{currentLoad.items.filter(item=>item.status==="active").map(item=><div key={item.id} className="rounded-xl border p-3 text-sm"><p>{item.bundle_number} · {item.order_number} · {formatWeight(item.net_weight_kg)}</p><Button type="button" variant="secondary" disabled={pending||releaseReason.trim().length<8} onClick={()=>releaseSavedBundle(item)}>Release saved bundle {item.bundle_number}</Button></div>)}</section>:null}
          <Button type="button" className="w-full" disabled={pending || !mayEdit || (!selectedBundles.length && !currentLoad) || !currentVehicle || overCapacity || !loadDate} onClick={saveLoad}>{pending ? "Saving review..." : currentLoad ? "Save reviewed load changes" : "Review and save vehicle load"}</Button>
          {!mayEdit ? <p className="text-xs font-semibold text-amber-800">This load is closed and cannot be edited.</p> : null}
          <div className="border-t border-slate-100 pt-4"><h3 className="font-black text-slate-950">Recent load reviews</h3><ul className="mt-2 space-y-2">{snapshot.loads.map(load => <li key={load.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 p-3 text-xs"><span><strong className="text-slate-800">{load.registration_number} · {load.load_date}</strong><span className="block mt-1 text-slate-500">{load.item_count} bundles · {formatWeight(load.total_weight_kg)} / {formatWeight(load.capacity_kg)} · {load.status}</span></span><Button type="button" variant="secondary" disabled={pending || load.status !== "reviewed"} onClick={() => selectLoad(load.id)}>Open</Button></li>)}{!snapshot.loads.length ? <li className="text-xs text-slate-500">No reviewed vehicle loads yet.</li> : null}</ul></div>
          <p className="border-t border-slate-100 pt-3 text-[11px] leading-relaxed text-slate-500">A measured bundle can belong to one active reviewed load. While assigned, dispatch requires removing it from this plan first. Load review does not create a packing row or consume inventory; dispatch still controls order availability.</p>
        </aside>
      </section>
    </div>
  );
}
