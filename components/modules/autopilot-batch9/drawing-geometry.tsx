"use client";

// AP-048: upload the profile's DXF drawing; the closed outlines are measured (outer area less voids, outer perimeter) and
// kg/m = net area x the alloy's density is proposed to the profile master with a preview. The owner or an admin accepts;
// the master weight then changes through the profile specification approval. The drawing stays in company storage.
import { useState } from "react";
import { AttachmentDropZone } from "@/components/ui/attachment-drop-zone";
import { readProfileDrawingAction } from "@/lib/actions/autopilot-batch9";
import { fmtWhen } from "@/lib/order-to-cash/commands";
import { uploadTenantFile } from "@/lib/utils/files";
import { ProposalCards } from "@/components/modules/autopilot/proposal-cards";
import { Empty, Failure, Loading, Message, Section, apWrite, buttonClass, inputClass, useApRead } from "../order-to-cash/ui";

type Note = { tone: "ok" | "error"; text: string } | null;
type Read = { id: string; file_name: string; status: string; units: string; net_area_mm2: number | null; outer_area_mm2: number | null; void_area_mm2: number | null; void_count: number | null;
  outer_perimeter_mm: number | null; density_kg_m3: number | null; density_source: string | null; kg_per_m: number | null; finishing_area_m2_per_m: number | null; warnings: string[];
  created_at: string; created_by_name: string | null; difference_percent: number | null; proposal_status: string | null; preview_svg?: string | null };
const STATUS: Record<string, string> = { proposed: "Proposed", accepted: "Accepted", rejected: "Rejected", superseded: "Replaced", unreadable: "No outline read", no_density: "Density missing" };

function Preview({ id }: { id: string }) {
  const data = useApRead<Read>("ap_geometry", "get", { id }, []);
  if (!data.data?.preview_svg) return null;
  // The database only stores the generator's single-path SVG; it is still shown as an image, which never runs script.
  // eslint-disable-next-line @next/next/no-img-element -- an inline data URI preview; nothing for the image optimiser to fetch
  return <img className="w-40 shrink-0 rounded-xl border bg-white p-1" alt="Section preview" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(data.data.preview_svg)}`} />;
}

export function DrawingGeometryPanel({ companyId, profileId, canUpload, canSetDensity, today }: { companyId: string; profileId: string; canUpload: boolean; canSetDensity: boolean; today: string }) {
  const [key, setKey] = useState(0); const [busy, setBusy] = useState(false); const [message, setMessage] = useState<Note>(null);
  const data = useApRead<{ rows: Read[]; density: { density: number | null; source: string | null } | null }>("ap_geometry", "reads", { profile_id: profileId }, [key]);
  const [alloy, setAlloy] = useState(""); const [density, setDensity] = useState("");
  async function take(file: File) {
    if (!/\.dxf$/i.test(file.name)) { setMessage({ tone: "error", text: "Upload the section drawing as a DXF file." }); return; }
    setBusy(true); setMessage(null);
    try {
      // A DXF has no registered browser type; it is stored as plain bytes and read back by the server.
      const path = await uploadTenantFile("documents", companyId, `profile-drawings/${profileId}`, new File([file], file.name, { type: "" }));
      const out = await readProfileDrawingAction({ profile_id: profileId, storage_path: path, file_name: file.name.slice(0, 200) });
      setBusy(false);
      if (!out.success) { setMessage({ tone: "error", text: out.error }); return; }
      setMessage({ tone: out.data.status === "proposed" ? "ok" : "error", text: out.data.status === "proposed" ? `Read: ${out.data.kg_per_m} kg/m proposed.` : out.data.status === "no_density" ? "Outline read, but the alloy has no density. Set it below." : `No closed outline could be read: ${out.data.warnings[0] ?? "check the drawing"}.` });
      setKey(k => k + 1);
    } catch {
      setBusy(false); setMessage({ tone: "error", text: "The drawing could not be uploaded. Check the connection and retry." });
    }
  }
  return <Section id="drawing-geometry" title="Weight from the die drawing" description="Closed outlines of the DXF section give the net area; area × alloy density gives the theoretical kg/m, and the outer perimeter the finishing area per metre.">
    {canUpload ? <AttachmentDropZone onFile={take} accept=".dxf" busy={busy} label={busy ? "Reading the drawing…" : "Upload the DXF drawing"} hint="Export the section only, in millimetres, as an ASCII DXF." /> : null}
    <Message value={message} />
    <ProposalCards key={`p-${key}`} type="profile.geometry" target={profileId} initial={null} today={today} title="Proposed to the profile master" emptyText="No proposal waiting." onDecided={() => setKey(k => k + 1)} />
    {data.loading && !data.data ? <Loading what="drawing reads" /> : data.error ? <Failure text={data.error} /> : data.data ? <>
      <p className="text-xs text-neutral-600">Density for this profile&apos;s alloy: {data.data.density?.density ? `${data.data.density.density} kg/m³ (${data.data.density.source === "alloy_master" ? "alloy master" : "standard value"})` : "not recorded"}.</p>
      {data.data.rows.length ? <ul className="space-y-2">{data.data.rows.map(r => <li key={r.id} className="flex flex-wrap gap-3 rounded-xl border p-3 text-sm">
        {r.net_area_mm2 !== null ? <Preview id={r.id} /> : null}
        <div className="min-w-0 flex-1"><p><b>{r.file_name}</b> · {STATUS[r.status] ?? r.status}{r.proposal_status ? ` · proposal ${r.proposal_status}` : ""}</p>
          {r.net_area_mm2 !== null ? <p>Net area {r.net_area_mm2} mm² (outer {r.outer_area_mm2} less {r.void_count ?? 0} void(s) {r.void_area_mm2}) · perimeter {r.outer_perimeter_mm} mm
            {r.kg_per_m !== null ? <> · <b>{r.kg_per_m} kg/m</b> at {r.density_kg_m3} kg/m³{r.difference_percent !== null ? ` (${r.difference_percent > 0 ? "+" : ""}${r.difference_percent}% against the master)` : ""}</> : null}</p> : null}
          {r.warnings?.length ? <ul className="list-disc pl-5 text-xs text-amber-800">{r.warnings.map(w => <li key={w}>{w}</li>)}</ul> : null}
          <p className="text-xs text-neutral-500">{r.units === "unknown" ? "Units not recorded in the drawing" : `Units ${r.units}`} · {r.created_by_name ?? "—"} {fmtWhen(r.created_at)}</p></div>
      </li>)}</ul> : <Empty>No drawing read yet.</Empty>}
    </> : null}
    {canSetDensity ? <div className="flex flex-wrap items-end gap-2 rounded-xl bg-neutral-50 p-3">
      <label className="text-xs font-bold">Alloy<input className={`${inputClass} w-28`} value={alloy} onChange={e => setAlloy(e.target.value)} placeholder="6063" /></label>
      <label className="text-xs font-bold">Density kg/m³<input className={`${inputClass} w-32`} inputMode="decimal" value={density} onChange={e => setDensity(e.target.value)} placeholder="2700" /></label>
      <button type="button" className={buttonClass} disabled={!alloy.trim() || !density} onClick={async () => { if (await apWrite("ap_geometry", "set_density", { alloy: alloy.trim(), density_kg_m3: Number(density) }, setMessage, "Density saved on the alloy master.")) setKey(k => k + 1); }}>Save density</button>
    </div> : null}
  </Section>;
}
