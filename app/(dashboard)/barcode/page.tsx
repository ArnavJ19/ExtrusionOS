"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3, Download, ExternalLink, Plus, QrCode, Search, Truck, Wrench, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/browser";
import type { QrEntityType } from "@/lib/qr/payload";
import { fetchQrEntityDetails, QR_ENTITY_LABELS, QR_ENTITY_TABLES, QR_ENTITY_TYPES } from "@/lib/qr/entities";

type EntityType = QrEntityType;

type QrRow = {
  id: string;
  entity_type: EntityType;
  entity_id: string;
  qr_value: string;
  status: string;
  created_at: string;
  expires_at: string | null;
  label: string | null;
};

type ScanRow = {
  id: string;
  entity_type: string;
  entity_id: string;
  action_type: string;
  scan_location: string | null;
  scanned_by: string | null;
  created_at: string;
};

const ENTITY_ICONS: Record<EntityType, typeof Wrench> = {
  profile: QrCode,
  die: Wrench,
  billet_batch: QrCode,
  inventory_batch: QrCode,
  inventory_item: QrCode,
  order: BarChart3,
  quote: BarChart3,
  production_job: BarChart3,
  dispatch_package: QrCode,
  dispatch: Truck,
  certificate: QrCode,
  machine: Wrench,
  maintenance: Wrench,
  document: QrCode,
};

export default function QRGeneratorPage() {
  const supabase = createClient();

  const [qrs, setQrs] = useState<QrRow[]>([]);
  const [scanEvents, setScanEvents] = useState<ScanRow[]>([]);
  const [entityType, setEntityType] = useState<EntityType>("die");
  const [entityId, setEntityId] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedQr, setSelectedQr] = useState<QrRow | null>(null);
  const [selectedEntityDetails, setSelectedEntityDetails] = useState<Record<string, unknown> | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  const loadData = async () => {
    const actor = await getActor(supabase);
    if (!actor) {
      setErrorMessage("Company context not found.");
      return;
    }
    const [qrResult, scanResult] = await Promise.all([
      supabase.from("qr_codes").select("*").eq("company_id", actor.companyId).order("created_at", { ascending: false }).limit(200),
      supabase.from("scan_events").select("*").eq("company_id", actor.companyId).order("created_at", { ascending: false }).limit(50),
    ]);
    if (qrResult.error) setErrorMessage(qrResult.error.message);
    if (scanResult.error) setErrorMessage((prev) => prev || scanResult.error.message);
    setQrs((qrResult.data ?? []) as any[]);
    setScanEvents((scanResult.data ?? []) as any[]);
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    const loadDetails = async () => {
      if (!selectedQr) {
        setSelectedEntityDetails(null);
        return;
      }
      const actor = await getActor(supabase);
      const details = actor ? await fetchQrEntityDetails(supabase, selectedQr.entity_type, selectedQr.entity_id, actor.companyId) : null;
      setSelectedEntityDetails(details);
    };
    loadDetails();
  }, [selectedQr, supabase]);

  const activeCount = useMemo(
    () => qrs.filter((row) => row.expires_at ? new Date(row.expires_at) >= new Date() : row.status === "active").length,
    [qrs],
  );

  const handleGenerate = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMessage("");
    if (!isUuid(entityId)) {
      setErrorMessage("Enter a valid entity UUID.");
      return;
    }

    const actor = await getActor(supabase);
    if (!actor) {
      setErrorMessage("Company not found.");
      return;
    }

    const entityDetails = await fetchQrEntityDetails(supabase, entityType, entityId, actor.companyId);
    if (!entityDetails) {
      setErrorMessage(`No ${QR_ENTITY_LABELS[entityType]} found for this UUID.`);
      return;
    }

    const response = await fetch("/api/qr-codes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
      entity_type: entityType,
      entity_id: entityId,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setErrorMessage(payload.error ?? "Could not create QR code.");
      return;
    }

    setEntityId("");
    setIsGenerating(false);
    await loadData();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <PageHeader title="QR and Barcode Generator" description="Generate 60-day QR codes linked to live scoped operational records." />
        <Button onClick={() => setIsGenerating(true)} className="gap-2 bg-orange text-white hover:bg-orange/90">
          <Plus className="h-4 w-4" />
          Generate QR
        </Button>
      </div>

      {errorMessage ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{errorMessage}</div> : null}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Metric label="Total QR" value={qrs.length.toString()} />
        <Metric label="Active" value={activeCount.toString()} />
        <Metric label="Recent Scans" value={scanEvents.length.toString()} />
        <Metric label="Entity Types" value={String(Object.keys(QR_ENTITY_TABLES).length)} />
      </div>

      {isGenerating ? (
        <Card className="border-orange/20 bg-orange/5">
          <CardHeader>
            <h3 className="font-bold text-slate-900">Create New QR</h3>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleGenerate} className="grid items-end gap-4 md:grid-cols-4">
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">Entity Type</label>
                <select value={entityType} onChange={(event) => setEntityType(event.target.value as EntityType)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  {QR_ENTITY_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {QR_ENTITY_LABELS[type]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-bold text-slate-700">Entity UUID</label>
                <input value={entityId} onChange={(event) => setEntityId(event.target.value)} placeholder="Paste linked record UUID" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" required />
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={() => setIsGenerating(false)} className="w-full">
                  Cancel
                </Button>
                <Button type="submit" className="w-full bg-slate-900 text-white hover:bg-slate-800">
                  Save
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/50 text-left text-slate-500">
                  <th className="px-6 py-4 font-medium">QR</th>
                  <th className="px-6 py-4 font-medium">Entity</th>
                  <th className="px-6 py-4 font-medium">Tracking Value</th>
                  <th className="px-6 py-4 font-medium">Expiry</th>
                  <th className="px-6 py-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {qrs.map((qr) => {
                  const isExpired = qr.expires_at ? new Date(qr.expires_at) < new Date() : false;
                  const Icon = ENTITY_ICONS[qr.entity_type];
                  return (
                    <tr key={qr.id} className="hover:bg-slate-50">
                      <td className="px-6 py-4">
                        <button onClick={() => setSelectedQr(qr)} className="rounded-lg border border-slate-200 bg-white p-2 transition hover:border-orange hover:shadow">
                          <QRCodeSVG id={`qr-${qr.id}`} value={qr.qr_value} size={56} level="M" />
                        </button>
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                          <Icon className="h-3 w-3" />
                          {QR_ENTITY_LABELS[qr.entity_type]}
                        </span>
                        <button onClick={() => setSelectedQr(qr)} className="mt-1 flex items-center gap-1 text-xs font-bold text-slate-900 transition hover:text-orange">
                          {qr.label ?? qr.entity_id}
                          <ExternalLink className="h-3 w-3" />
                        </button>
                      </td>
                      <td className="px-6 py-4 text-xs font-mono text-slate-700">{qr.qr_value}</td>
                      <td className="px-6 py-4">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${isExpired ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>{isExpired ? "Expired" : "Active"}</span>
                        <p className="mt-1 text-xs text-slate-500">{qr.expires_at ? new Date(qr.expires_at).toLocaleDateString() : "-"}</p>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => downloadQrSvg(qr.id, qr.label ?? qr.entity_id)}>
                          <Download className="mr-1 h-4 w-4" />
                          SVG
                        </Button>
                        <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setSelectedQr(qr)}>
                          <Search className="mr-1 h-4 w-4" />
                          Details
                        </Button>
                      </td>
                    </tr>
                  );
                })}
                {!qrs.length ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-sm font-semibold text-slate-500">
                      No QR codes yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h3 className="font-black text-slate-950">Recent Scan Events</h3>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/50 text-left text-slate-500">
                  <th className="px-4 py-3 font-medium">Action</th>
                  <th className="px-4 py-3 font-medium">Entity</th>
                  <th className="px-4 py-3 font-medium">Location</th>
                  <th className="px-4 py-3 font-medium">Scanned By</th>
                  <th className="px-4 py-3 font-medium">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {scanEvents.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3 text-xs font-black text-slate-900">{row.action_type}</td>
                    <td className="px-4 py-3 text-xs">
                      {row.entity_type}
                      <p className="text-[10px] text-slate-500">{row.entity_id}</p>
                    </td>
                    <td className="px-4 py-3 text-xs">{row.scan_location || "-"}</td>
                    <td className="px-4 py-3 text-xs">{row.scanned_by || "-"}</td>
                    <td className="px-4 py-3 text-xs">{new Date(row.created_at).toLocaleString()}</td>
                  </tr>
                ))}
                {!scanEvents.length ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm font-semibold text-slate-500">
                      No scans recorded.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {selectedQr ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={() => setSelectedQr(null)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between rounded-t-3xl bg-slate-900 p-5 text-white">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">QR Detail</p>
                <p className="text-lg font-black">{selectedQr.label ?? selectedQr.entity_id}</p>
              </div>
              <button onClick={() => setSelectedQr(null)} className="rounded-lg p-2 transition hover:bg-white/10">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-5">
              <div className="flex justify-center rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <QRCodeSVG value={selectedQr.qr_value} size={180} level="H" />
              </div>
              <div className="space-y-2 text-xs">
                <Field label="Entity Type" value={QR_ENTITY_LABELS[selectedQr.entity_type]} />
                <Field label="Entity UUID" value={selectedQr.entity_id} />
                <Field label="QR Value" value={selectedQr.qr_value} mono />
                <Field label="Expires" value={selectedQr.expires_at ? new Date(selectedQr.expires_at).toLocaleString() : "-"} />
              </div>
              {selectedEntityDetails ? (
                <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Linked Entity Snapshot</p>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(selectedEntityDetails).map(([key, value]) => (
                      <div key={key}>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{key.replace(/_/g, " ")}</p>
                        <p className="text-xs text-slate-800">{String(value)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="flex gap-3">
                <Button variant="secondary" className="flex-1" onClick={() => setSelectedQr(null)}>
                  Close
                </Button>
                <Button className="flex-1 bg-slate-900 text-white hover:bg-slate-800" onClick={() => downloadQrSvg(selectedQr.id, selectedQr.label ?? selectedQr.entity_id)}>
                  <Download className="mr-2 h-4 w-4" />
                  Download QR
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

async function getActor(supabase: ReturnType<typeof createClient>) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) return null;
  const { data: appUser, error: appUserError } = await supabase.from("app_users").select("company_id").eq("id", user.id).single();
  if (appUserError || !appUser?.company_id) return null;
  return { userId: user.id, companyId: String(appUser.company_id) };
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function downloadQrSvg(id: string, label: string) {
  const svg = document.getElementById(`qr-${id}`);
  if (!svg) return;
  const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `qr-${label.replace(/[^a-zA-Z0-9_-]/g, "-")}.svg`;
  link.click();
  URL.revokeObjectURL(url);
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
        <p className="mt-1 text-2xl font-black text-slate-900">{value}</p>
      </CardContent>
    </Card>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`text-xs text-slate-800 ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}
