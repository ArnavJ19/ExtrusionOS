"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Camera, KeySquare, ShieldCheck } from "lucide-react";
import { Html5QrcodeScanner } from "html5-qrcode";
import { createClient } from "@/lib/supabase/browser";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { parseQrPayload } from "@/lib/qr/payload";

type QrEntity = {
  qrId: string;
  entityType: string;
  entityId: string;
  qrValue: string;
  label: string | null;
  status: string;
  expiresAt: string | null;
  details: Record<string, unknown> | null;
};

const ENTITY_TABLES: Record<string, { table: string; select: string }> = {
  profile: { table: "aluminium_profiles", select: "id, profile_code, profile_name, section_weight_kg_per_m" },
  die: { table: "dies", select: "id, die_number, die_status, rack_location" },
  billet_batch: { table: "billet_batches", select: "id, batch_number, alloy, temper, status" },
  inventory_batch: { table: "profile_stock_batches", select: "id, bundle_number, status, quantity_pieces, total_weight_kg" },
  production_job: { table: "production_jobs", select: "id, job_number, status, machine_id" },
  dispatch_package: { table: "packing_list_items", select: "id, bundle_number, number_of_pieces, gross_weight_kg, net_weight_kg" },
  dispatch: { table: "dispatches", select: "id, dispatch_number, delivery_status, transporter_name, vehicle_number" },
  inventory_item: { table: "inventory_items", select: "id, item_code, item_name, current_stock, unit, location" },
  order: { table: "orders", select: "id, order_number, current_stage, expected_dispatch_date" },
  quote: { table: "quotes", select: "id, quote_number, status, quote_date, grand_total" },
  certificate: { table: "technical_documents", select: "id, file_name, document_type, approval_status, expiry_date" },
  machine: { table: "machines", select: "id, machine_code, machine_name, status" },
  maintenance: { table: "maintenance_schedules", select: "id, machine_id, machine_type, maintenance_type, status, next_due_date" },
  document: { table: "technical_documents", select: "id, file_name, document_type, approval_status" }
};

export default function QRScannerPage() {
  const supabase = createClient();
  const [mode, setMode] = useState<"camera" | "manual" | null>(null);
  const [manualCode, setManualCode] = useState("");
  const [error, setError] = useState("");
  const [entity, setEntity] = useState<QrEntity | null>(null);
  const [processing, setProcessing] = useState(false);
  const [actor, setActor] = useState<{ userId: string; companyId: string } | null>(null);

  useEffect(() => {
    const loadActor = async () => {
      const {
        data: { user }
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from("app_users").select("company_id").eq("id", user.id).single();
      if (data?.company_id) {
        setActor({ userId: user.id, companyId: data.company_id });
      }
    };
    loadActor();
  }, [supabase]);

  async function resolveCode(rawCode: string) {
    const code = rawCode.trim();
    if (!code) return;
    if (!actor) {
      setEntity(null);
      setError("User/company context is still loading. Please try again in a moment.");
      return;
    }
    setProcessing(true);
    setError("");
    const parsedPayload = parseQrPayload(code);
    if (parsedPayload?.companyId && parsedPayload.companyId !== actor.companyId) {
      setEntity(null);
      setError("This QR belongs to another company and cannot be opened.");
      setProcessing(false);
      return;
    }

    const qrQuery = await supabase
      .from("qr_codes")
      .select("id, entity_type, entity_id, qr_value, label, status, expires_at, company_id")
      .eq("qr_value", code)
      .eq("company_id", actor.companyId)
      .maybeSingle();

    let qr = qrQuery.data;
    if (!qr && parsedPayload) {
      const byParsedEntity = await supabase
        .from("qr_codes")
        .select("id, entity_type, entity_id, qr_value, label, status, expires_at, company_id")
        .eq("entity_id", parsedPayload.entityId)
        .eq("entity_type", parsedPayload.entityType)
        .eq("company_id", actor.companyId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      qr = byParsedEntity.data;
    }
    if (!qr && isUuid(code)) {
      const byEntity = await supabase
        .from("qr_codes")
        .select("id, entity_type, entity_id, qr_value, label, status, expires_at, company_id")
        .eq("entity_id", code)
        .eq("company_id", actor.companyId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      qr = byEntity.data;
    }

    if (!qr) {
      setEntity(null);
      setError("QR not found or not linked to an active ERP entity.");
      setProcessing(false);
      return;
    }

    if (qr.expires_at && new Date(qr.expires_at) < new Date()) {
      setEntity(null);
      setError("This QR code has expired and cannot be used for operations.");
      setProcessing(false);
      return;
    }

    const entityType = String(qr.entity_type);
    const entityId = String(qr.entity_id);
    const entityConfig = ENTITY_TABLES[entityType];
    let details: Record<string, unknown> | null = null;

    if (entityConfig) {
      const detailsResult = await supabase
        .from(entityConfig.table)
        .select(entityConfig.select)
        .eq("id", entityId)
        .eq("company_id", actor.companyId)
        .maybeSingle();
      details = (detailsResult.data as Record<string, unknown> | null) ?? null;
    }

    setEntity({
      qrId: String(qr.id),
      entityType,
      entityId,
      qrValue: String(qr.qr_value),
      label: (qr.label as string | null) ?? null,
      status: String(qr.status),
      expiresAt: (qr.expires_at as string | null) ?? null,
      details
    });
    setMode(null);
    setProcessing(false);

    await supabase.from("scan_events").insert({
      company_id: actor.companyId,
      qr_code_id: qr.id,
      entity_type: entityType,
      entity_id: entityId,
      scanned_by: actor.userId,
      action_type: "viewed",
      metadata_json: { source: mode === "camera" ? "camera" : "manual", scanned_value: code }
    });
    await supabase.from("qr_codes").update({ last_scanned_at: new Date().toISOString() }).eq("id", qr.id).eq("company_id", actor.companyId);
  }

  useEffect(() => {
    let scanner: Html5QrcodeScanner | null = null;
    if (mode === "camera") {
      scanner = new Html5QrcodeScanner("qr-reader", { fps: 10, qrbox: { width: 250, height: 250 } }, false);
      scanner.render(
        async (decodedText) => {
          if (scanner) await scanner.clear();
          await resolveCode(decodedText);
        },
        () => {}
      );
    }
    return () => {
      if (scanner) scanner.clear().catch(() => {});
    };
  }, [mode]);

  const title = useMemo(() => {
    if (!entity) return "";
    return entity.label || entity.entityId;
  }, [entity]);

  async function recordAction(actionType: "loaded_for_dispatch" | "stock_checked" | "die_checked") {
    if (!entity || !actor) return;
    const { error: insertError } = await supabase.from("scan_events").insert({
      company_id: actor.companyId,
      qr_code_id: entity.qrId,
      entity_type: entity.entityType,
      entity_id: entity.entityId,
      scanned_by: actor.userId,
      action_type: actionType
    });
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setEntity(null);
    setManualCode("");
  }

  return (
    <div className="mx-auto flex min-h-[80vh] max-w-md flex-col pt-4">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-black text-slate-900">Shop Floor Scanner</h1>
        <p className="mt-1 text-sm text-slate-500">Scan real QR records and log tracked actions</p>
      </div>

      {error ? <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{error}</div> : null}

      {!mode && !entity ? (
        <div className="flex flex-1 flex-col justify-center gap-4">
          <button onClick={() => setMode("camera")} className="flex flex-col items-center justify-center rounded-3xl bg-slate-900 p-10 text-white shadow-xl transition hover:bg-slate-800 active:scale-95">
            <Camera className="mb-4 h-16 w-16 text-orange" />
            <span className="text-xl font-bold">Open Camera</span>
            <span className="mt-2 text-sm text-slate-400">{processing ? "Resolving..." : "Tap to scan QR Code"}</span>
          </button>

          <button onClick={() => setMode("manual")} className="mt-4 flex items-center justify-center gap-3 rounded-2xl border-2 border-slate-200 bg-white p-4 text-slate-700 shadow-sm transition hover:border-slate-300 active:scale-95">
            <KeySquare className="h-5 w-5 text-slate-400" />
            <span className="font-bold">Enter Code Manually</span>
          </button>
        </div>
      ) : null}

      {mode === "camera" ? (
        <div className="animate-in fade-in zoom-in-95 flex flex-1 flex-col">
          <div className="relative overflow-hidden rounded-3xl border-4 border-slate-900 bg-white p-4 shadow-2xl">
            <div id="qr-reader" className="w-full overflow-hidden rounded-xl"></div>
          </div>
          <div className="mt-6 flex justify-between gap-4">
            <Button variant="secondary" className="flex-1" onClick={() => setMode(null)}>Cancel Scan</Button>
          </div>
        </div>
      ) : null}

      {mode === "manual" ? (
        <Card className="animate-in fade-in slide-in-from-bottom-4 mt-8 rounded-3xl border-2 border-slate-200 shadow-xl">
          <CardContent className="pt-6">
            <form onSubmit={(event) => { event.preventDefault(); resolveCode(manualCode); }} className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-bold text-slate-700">QR Code Value</label>
                <input type="text" autoFocus className="w-full rounded-xl border-2 border-slate-200 p-4 text-center text-xl font-black uppercase tracking-widest transition focus:border-orange focus:ring-0" placeholder="Paste qr_value or entity UUID" value={manualCode} onChange={(event) => setManualCode(event.target.value)} />
              </div>
              <div className="flex gap-3 pt-2">
                <Button type="button" variant="ghost" className="flex-1" onClick={() => setMode(null)}>Cancel</Button>
                <Button type="submit" disabled={!manualCode.trim() || processing} className="flex-1 bg-slate-900 text-white hover:bg-slate-800">{processing ? "Searching..." : "Search"}</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {entity ? (
        <div className="animate-in slide-in-from-bottom-8 mb-auto mt-auto">
          <Card className="overflow-hidden rounded-3xl border-2 border-green-600 shadow-2xl">
            <div className="flex items-center justify-between bg-green-600 p-4 text-white">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-green-700 p-2"><ShieldCheck className="h-6 w-6 text-white" /></div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-green-200">Verified {entity.entityType.replace(/_/g, " ")}</p>
                  <p className="text-lg font-black">{title}</p>
                </div>
              </div>
            </div>
            <CardContent className="space-y-6 p-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <p className="mb-1 text-xs font-bold text-slate-500">QR Status</p>
                  <p className="text-sm font-bold capitalize text-slate-900">{entity.status.replace(/_/g, " ")}</p>
                </div>
                <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <p className="mb-1 text-xs font-bold text-slate-500">Expires</p>
                  <p className="text-sm font-bold text-slate-900">{entity.expiresAt ? new Date(entity.expiresAt).toLocaleDateString() : "-"}</p>
                </div>
              </div>

              {entity.details ? (
                <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Linked Entity Snapshot</p>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(entity.details).map(([key, value]) => (
                      <div key={key}>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{key.replace(/_/g, " ")}</p>
                        <p className="text-xs text-slate-800">{String(value ?? "-")}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="space-y-3 border-t border-slate-100 pt-4">
                <p className="text-center text-xs font-bold uppercase tracking-wider text-slate-500">Record Scan Event</p>
                <Button onClick={() => recordAction("loaded_for_dispatch")} className="flex h-12 w-full justify-between rounded-xl bg-slate-900 px-6 font-bold text-white hover:bg-slate-800">
                  Load for Dispatch <ArrowRight className="h-5 w-5" />
                </Button>
                <Button onClick={() => recordAction("stock_checked")} variant="secondary" className="h-12 w-full rounded-xl border border-slate-200 font-bold">
                  Mark as Audited
                </Button>
                <Button onClick={() => recordAction("die_checked")} variant="secondary" className="h-12 w-full rounded-xl border border-slate-200 font-bold">
                  Mark Die Checked
                </Button>
              </div>
            </CardContent>
          </Card>
          <button onClick={() => setEntity(null)} className="mt-6 w-full text-sm font-bold text-slate-500 hover:text-slate-900">Scan Another Item</button>
        </div>
      ) : null}
    </div>
  );
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
