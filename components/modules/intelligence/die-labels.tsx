"use client";

// FS-16: rack labels so a die can be found in a minute. Each label carries a version-2 ExtrusionOS QR code (entity type,
// die id and a nonce; never the company or a link), which the existing scanner resolves to the die.
import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { buildQrPayloadV2 } from "@/lib/qr/payload";
import { Empty, Failure, Loading, Section, buttonClass, inputClass, useFsRead } from "./shared";

type Label = { id: string; die_number: string; profile_code: string | null; rack_location: string | null; storage_bin: string | null };

export function DieLabels() {
  const [search, setSearch] = useState(""); const [chosen, setChosen] = useState<Set<string>>(new Set());
  const d = useFsRead<{ rows: Label[] }>("fs_die_life", "labels", search.trim() ? { search: search.trim() } : {}, []);
  const rows = d.data?.rows ?? [];
  const printing = rows.filter(r => chosen.has(r.id));
  return <div className="space-y-4">
    <Section title="Choose dies" description="Search by die number or rack. Up to 60 shown.">
      <div className="flex flex-wrap items-end gap-2 print:hidden">
        <input aria-label="Search dies or racks" className={`${inputClass} w-64`} placeholder="Die or rack" value={search} onChange={e => setSearch(e.target.value)} />
        <button type="button" className={buttonClass} disabled={!printing.length} onClick={() => window.print()}>Print {printing.length} label(s)</button>
        <button type="button" className="text-sm font-bold underline" onClick={() => setChosen(new Set(rows.map(r => r.id)))}>Select all shown</button>
      </div>
      {d.loading && !d.data ? <Loading what="dies" /> : d.error ? <Failure text={d.error} /> : rows.length ? <ul className="grid gap-1 text-sm sm:grid-cols-2 print:hidden">{rows.map(r => <li key={r.id}>
        <label className="flex items-center gap-2"><input type="checkbox" checked={chosen.has(r.id)} onChange={e => setChosen(c => { const n = new Set(c); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} />
          <span><b>{r.die_number}</b> {r.profile_code ?? ""} · rack {r.rack_location ?? "not recorded"}</span></label></li>)}</ul> : <Empty>No active dies match.</Empty>}
    </Section>
    {printing.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Labels">{printing.map(r => <figure key={r.id} className="flex break-inside-avoid flex-col items-center rounded-xl border-2 border-neutral-900 bg-white p-3 text-center">
      <QRCodeSVG value={buildQrPayloadV2("die", r.id, "rack")} size={128} level="M" />
      <figcaption className="mt-2"><p className="text-xl font-black">{r.die_number}</p><p className="text-sm">{r.profile_code ?? ""}</p><p className="text-sm font-bold">Rack {r.rack_location ?? "—"}{r.storage_bin ? ` · bin ${r.storage_bin}` : ""}</p></figcaption>
    </figure>)}</div> : null}
  </div>;
}
