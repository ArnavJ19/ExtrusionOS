"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileUp, Eye, CheckCircle, XCircle, Clock, MessageSquare, X, Download } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { technicalDrawingUploadRules, validateUploadFile } from "@/lib/validations/uploads";

type Drawing = {
  id: string; drawing_number: string; title: string; related_entity_type: string; related_entity_id: string;
  revision_number: number; approval_status: string; uploaded_by: string; notes: string; created_at: string;
  file_name?: string | null; file_mime_type?: string | null; storage_bucket?: string | null; storage_path?: string | null; file_url?: string | null;
};

type TQ = {
  id: string; tq_number: string; drawing_number: string; query_text: string; response_text: string;
  status: string; priority: string; assigned_to: string; raised_by: string; created_at: string;
};

const CAD_EXTENSIONS = new Set(["dwg", "dxf", "dgn", "step", "stp", "iges", "igs", "sat", "stl", "3dm"]);

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700", under_review: "bg-amber-100 text-amber-800", approved_internal: "bg-blue-100 text-blue-800",
  sent_to_customer: "bg-purple-100 text-purple-800", customer_approved: "bg-green-100 text-green-800", rejected: "bg-red-100 text-red-800", obsolete: "bg-slate-200 text-slate-500",
};

const TQ_STATUS_BADGE: Record<string, string> = {
  open: "bg-red-100 text-red-800", in_progress: "bg-amber-100 text-amber-800", responded: "bg-blue-100 text-blue-800", closed: "bg-green-100 text-green-800",
};

const PRIORITY_BADGE: Record<string, string> = {
  low: "bg-slate-100 text-slate-600", normal: "bg-blue-100 text-blue-700", high: "bg-amber-100 text-amber-800", critical: "bg-red-100 text-red-800",
};

export default function DocumentIntelligencePage() {
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [tqs, setTqs] = useState<TQ[]>([]);
  const [selectedDrawing, setSelectedDrawing] = useState<Drawing | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [tab, setTab] = useState<"drawings" | "tqs">("drawings");
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  // Upload form state
  const [newTitle, setNewTitle] = useState("");
  const [newEntityType, setNewEntityType] = useState("die");
  const [newEntityId, setNewEntityId] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [newFile, setNewFile] = useState<File | null>(null);

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const [drawingsResult, tqsResult] = await Promise.all([
        supabase.from("technical_drawings").select("*").order("created_at", { ascending: false }).limit(100),
        supabase.from("technical_queries").select("id, tq_number, related_drawing_id, query_text, response_text, status, priority, created_at").order("created_at", { ascending: false }).limit(100),
      ]);
      if (drawingsResult.error) setErrorMessage(drawingsResult.error.message);
      setDrawings((drawingsResult.data ?? []).map((row: any) => ({ ...row, uploaded_by: row.uploaded_by ?? "User", related_entity_id: row.related_entity_id ?? "" })));
      setTqs((tqsResult.data ?? []).map((row: any) => ({ ...row, drawing_number: row.related_drawing_id ?? "-", assigned_to: "-", raised_by: "-" })));
    };
    load();
  }, []);

  useEffect(() => {
    const loadSignedUrl = async () => {
      setViewerUrl(null);
      if (!selectedDrawing?.storage_path && !selectedDrawing?.file_url) return;
      if (selectedDrawing.file_url && !selectedDrawing.storage_path) {
        setViewerUrl(selectedDrawing.file_url);
        return;
      }
      const supabase = createClient();
      const { data, error } = await supabase.storage.from(selectedDrawing.storage_bucket ?? "technical-drawings").createSignedUrl(selectedDrawing.storage_path ?? "", 3600);
      if (error) setErrorMessage(error.message);
      setViewerUrl(data?.signedUrl ?? null);
    };
    loadSignedUrl();
  }, [selectedDrawing]);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage("");
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return setErrorMessage("You must be logged in to upload drawings.");
    const { data: appUser, error: appUserError } = await supabase.from("app_users").select("company_id, full_name").eq("id", user.id).single();
    if (appUserError || !appUser?.company_id) return setErrorMessage(appUserError?.message ?? "Company not found.");

    let storagePath: string | null = null;
    if (newFile) {
      const validation = validateUploadFile(newFile, technicalDrawingUploadRules);
      if (!validation.ok) return setErrorMessage(validation.error ?? "File is not allowed.");
      const safeName = newFile.name.replace(/[^a-zA-Z0-9._-]/g, "-");
      storagePath = `${appUser.company_id}/drawings/${crypto.randomUUID()}-${safeName}`;
      const { error } = await supabase.storage.from("technical-drawings").upload(storagePath, newFile, { upsert: false });
      if (error) return setErrorMessage(error.message);
    }

    const drawingNumber = `DWG-${new Date().getFullYear()}-${String(drawings.length + 1).padStart(3, "0")}`;
    const insert = {
      company_id: appUser.company_id,
      drawing_number: drawingNumber,
      title: newTitle,
      related_entity_type: newEntityType,
      related_entity_id: uuidOrNull(newEntityId),
      revision_number: 1,
      approval_status: "draft",
      uploaded_by: user.id,
      notes: newNotes,
      file_name: newFile?.name ?? null,
      file_mime_type: newFile?.type || null,
      file_size_bytes: newFile?.size ?? null,
      storage_bucket: newFile ? "technical-drawings" : null,
      storage_path: storagePath,
    };
    const { data, error } = await supabase.from("technical_drawings").insert(insert).select("*").single();
    if (error || !data) return setErrorMessage(error?.message ?? "Could not save drawing.");
    const newDrawing: Drawing = {
      ...data,
      uploaded_by: appUser.full_name ?? user.email ?? "User",
      related_entity_id: data.related_entity_id ?? "",
    };
    setDrawings([newDrawing, ...drawings]);
    setIsUploading(false);
    setNewTitle(""); setNewEntityId(""); setNewNotes(""); setNewFile(null);
  };

  const handleStatusChange = (id: string, newStatus: string) => {
    setDrawings(drawings.map(d => d.id === id ? { ...d, approval_status: newStatus } : d));
    setSelectedDrawing(prev => prev && prev.id === id ? { ...prev, approval_status: newStatus } : prev);
  };

  const stats = {
    total: drawings.length,
    pending: drawings.filter(d => ["draft", "under_review", "sent_to_customer"].includes(d.approval_status)).length,
    approved: drawings.filter(d => ["approved_internal", "customer_approved"].includes(d.approval_status)).length,
    openTqs: tqs.filter(t => t.status === "open" || t.status === "in_progress").length,
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <PageHeader title="Document Intelligence" description="Manage technical drawings, revisions, approvals, and technical queries." />
        <Button onClick={() => setIsUploading(true)} className="bg-orange hover:bg-orange/90 text-white gap-2">
          <FileUp className="w-4 h-4" /> Upload Drawing
        </Button>
      </div>
      {errorMessage ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{errorMessage}</div> : null}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Drawings", value: stats.total, color: "text-slate-900" },
          { label: "Pending Review", value: stats.pending, color: "text-amber-600" },
          { label: "Approved", value: stats.approved, color: "text-green-600" },
          { label: "Open TQs", value: stats.openTqs, color: "text-red-600" },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">{s.label}</p>
              <p className={`text-2xl font-black mt-1 ${s.color}`}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Upload Form */}
      {isUploading && (
        <Card className="border-orange/20 bg-orange/5 animate-in fade-in slide-in-from-top-4">
          <CardHeader><h3 className="font-bold text-slate-900">Upload New Technical Drawing</h3></CardHeader>
          <CardContent>
            <form onSubmit={handleUpload} className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Drawing Title</label>
                <input type="text" value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="e.g. 25mm Frame Section View" className="w-full rounded-lg border-slate-200 text-sm" required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Link To</label>
                  <select value={newEntityType} onChange={e => setNewEntityType(e.target.value)} className="w-full rounded-lg border-slate-200 text-sm">
                    <option value="die">Die</option><option value="profile">Profile</option><option value="quote">Quote</option>
                    <option value="order">Order</option><option value="customer">Customer</option><option value="general">General</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Entity ID</label>
                  <input type="text" value={newEntityId} onChange={e => setNewEntityId(e.target.value)} placeholder="Related record ID" className="w-full rounded-lg border-slate-200 text-sm" />
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Notes</label>
                <input type="text" value={newNotes} onChange={e => setNewNotes(e.target.value)} placeholder="Optional notes…" className="w-full rounded-lg border-slate-200 text-sm" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">File</label>
                <input type="file" onChange={e => setNewFile(e.target.files?.[0] ?? null)} className="w-full rounded-lg border border-slate-200 text-sm p-2 bg-white" accept=".pdf,.png,.jpg,.jpeg,.webp,.dxf,.dwg,.dgn,.step,.stp,.iges,.igs,.sat,.stl,.3dm" />
                <p className="mt-1 text-[10px] font-semibold text-slate-500">PDF/images preview in-app. CAD files are stored as download-only. SVG/text/CSV files are blocked.</p>
              </div>
              <div className="md:col-span-2 flex gap-3 justify-end">
                <Button type="button" variant="secondary" onClick={() => setIsUploading(false)}>Cancel</Button>
                <Button type="submit" className="bg-slate-900 text-white hover:bg-slate-800">Upload & Save</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
        <button onClick={() => setTab("drawings")} className={`px-4 py-2 rounded-lg text-sm font-bold transition ${tab === "drawings" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
          Drawings ({drawings.length})
        </button>
        <button onClick={() => setTab("tqs")} className={`px-4 py-2 rounded-lg text-sm font-bold transition ${tab === "tqs" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
          Technical Queries ({tqs.length})
        </button>
      </div>

      {/* Drawings Table */}
      {tab === "drawings" && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/50 text-left text-slate-500">
                    <th className="px-6 py-4 font-medium">Drawing #</th>
                    <th className="px-6 py-4 font-medium">Title</th>
                    <th className="px-6 py-4 font-medium">Linked To</th>
                    <th className="px-6 py-4 font-medium">Rev</th>
                    <th className="px-6 py-4 font-medium">Status</th>
                    <th className="px-6 py-4 font-medium">Uploaded</th>
                    <th className="px-6 py-4 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {drawings.map(d => (
                    <tr key={d.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 font-bold text-slate-900 font-mono text-xs">{d.drawing_number}</td>
                      <td className="px-6 py-4 font-medium text-slate-800 max-w-[200px] truncate">{d.title}</td>
                      <td className="px-6 py-4">
                        <span className="text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full capitalize font-medium">{d.related_entity_type}</span>
                        <span className="ml-1.5 font-bold text-slate-900 text-xs">{d.related_entity_id}</span>
                      </td>
                      <td className="px-6 py-4"><span className="bg-slate-200 text-slate-700 text-xs font-bold px-2 py-0.5 rounded-full">R{d.revision_number}</span></td>
                      <td className="px-6 py-4">
                        <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full capitalize ${STATUS_BADGE[d.approval_status] || "bg-slate-100 text-slate-600"}`}>
                          {d.approval_status.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-slate-500 text-xs">
                        <p className="font-medium">{d.uploaded_by}</p>
                        <p>{new Date(d.created_at).toLocaleDateString()}</p>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Button variant="ghost" className="text-xs" onClick={() => setSelectedDrawing(d)}>
                          <Eye className="w-3.5 h-3.5 mr-1" /> View
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {drawings.length === 0 && <tr><td colSpan={7} className="px-6 py-12 text-center text-sm font-semibold text-slate-500">No drawings uploaded yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* TQs Table */}
      {tab === "tqs" && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/50 text-left text-slate-500">
                    <th className="px-6 py-4 font-medium">TQ #</th>
                    <th className="px-6 py-4 font-medium">Drawing</th>
                    <th className="px-6 py-4 font-medium">Query</th>
                    <th className="px-6 py-4 font-medium">Priority</th>
                    <th className="px-6 py-4 font-medium">Status</th>
                    <th className="px-6 py-4 font-medium">Assigned</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {tqs.map(tq => (
                    <tr key={tq.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 font-bold text-slate-900 font-mono text-xs">{tq.tq_number}</td>
                      <td className="px-6 py-4 font-mono text-xs text-slate-600">{tq.drawing_number}</td>
                      <td className="px-6 py-4 max-w-[300px]">
                        <p className="text-slate-800 font-medium truncate">{tq.query_text}</p>
                        {tq.response_text && <p className="text-xs text-green-700 mt-1 truncate">↳ {tq.response_text}</p>}
                      </td>
                      <td className="px-6 py-4"><span className={`text-xs font-medium px-2.5 py-0.5 rounded-full capitalize ${PRIORITY_BADGE[tq.priority]}`}>{tq.priority}</span></td>
                      <td className="px-6 py-4"><span className={`text-xs font-medium px-2.5 py-0.5 rounded-full capitalize ${TQ_STATUS_BADGE[tq.status]}`}>{tq.status.replace(/_/g, " ")}</span></td>
                      <td className="px-6 py-4 text-xs text-slate-600 font-medium">{tq.assigned_to}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Drawing Detail Modal */}
      {selectedDrawing && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in" onClick={() => setSelectedDrawing(null)}>
          <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-slate-900 text-white p-5 rounded-t-3xl flex items-center justify-between z-10">
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wider font-bold">Technical Drawing</p>
                <p className="font-black text-lg">{selectedDrawing.drawing_number} — Rev {selectedDrawing.revision_number}</p>
              </div>
              <button onClick={() => setSelectedDrawing(null)} className="p-2 hover:bg-white/10 rounded-lg transition"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {[
                  ["Title", selectedDrawing.title],
                  ["Linked Entity", `${selectedDrawing.related_entity_type} → ${selectedDrawing.related_entity_id}`],
                  ["Uploaded By", selectedDrawing.uploaded_by],
                  ["Date", new Date(selectedDrawing.created_at).toLocaleDateString()],
                  ["Status", selectedDrawing.approval_status.replace(/_/g, " ")],
                  ["Notes", selectedDrawing.notes || "—"],
                  ["File", selectedDrawing.file_name || "No file attached"],
                ].map(([label, val]) => (
                  <div key={label as string} className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-0.5">{label}</p>
                    <p className="text-sm text-slate-900 font-bold capitalize">{val}</p>
                  </div>
                ))}
              </div>

              <FileViewer drawing={selectedDrawing} signedUrl={viewerUrl} />

              {/* Approval Actions */}
              <div className="border-t border-slate-200 pt-4 space-y-2">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Change Status</p>
                <div className="flex flex-wrap gap-2">
                  {["under_review", "approved_internal", "sent_to_customer", "customer_approved", "rejected"].map(s => (
                    <Button key={s} variant="secondary" className={`text-xs capitalize ${selectedDrawing.approval_status === s ? "ring-2 ring-orange" : ""}`}
                      onClick={() => handleStatusChange(selectedDrawing.id, s)}>
                      {s === "approved_internal" || s === "customer_approved" ? <CheckCircle className="w-3 h-3 mr-1" /> : s === "rejected" ? <XCircle className="w-3 h-3 mr-1" /> : <Clock className="w-3 h-3 mr-1" />}
                      {s.replace(/_/g, " ")}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Related TQs */}
              {tqs.filter(t => t.drawing_number === selectedDrawing.drawing_number).length > 0 && (
                <div className="border-t border-slate-200 pt-4">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1"><MessageSquare className="w-3 h-3" /> Related Technical Queries</p>
                  {tqs.filter(t => t.drawing_number === selectedDrawing.drawing_number).map(tq => (
                    <div key={tq.id} className="bg-slate-50 p-3 rounded-xl border border-slate-100 mb-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-xs text-slate-900">{tq.tq_number}</span>
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full capitalize ${TQ_STATUS_BADGE[tq.status]}`}>{tq.status}</span>
                      </div>
                      <p className="text-xs text-slate-700">{tq.query_text}</p>
                      {tq.response_text && <p className="text-xs text-green-700 mt-1">↳ {tq.response_text}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="p-5 border-t border-slate-200">
              <div className="flex gap-3">
                <Button variant="secondary" className="flex-1" onClick={() => setSelectedDrawing(null)}>Close</Button>
                {viewerUrl ? <a href={viewerUrl} download={selectedDrawing.file_name ?? undefined} className="inline-flex flex-1 items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800"><Download className="mr-2 h-4 w-4" /> Download</a> : null}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function uuidOrNull(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null;
}

function fileExtension(name?: string | null) {
  return (name?.split(".").pop() ?? "").toLowerCase();
}

function FileViewer({ drawing, signedUrl }: { drawing: Drawing; signedUrl: string | null }) {
  if (!drawing.file_name && !signedUrl) return <div className="rounded-xl border border-dashed border-slate-200 p-4 text-sm font-semibold text-slate-500">No uploaded file attached to this drawing.</div>;
  const extension = fileExtension(drawing.file_name);
  if (CAD_EXTENSIONS.has(extension)) return <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-800">CAD file preview is disabled. Use Download to open this file in CAD software.</div>;
  if (!signedUrl) return <div className="rounded-xl border border-slate-200 p-4 text-sm font-semibold text-slate-500">Preparing secure preview link...</div>;
  const mime = drawing.file_mime_type ?? "";
  if (mime.startsWith("image/") || ["jpg", "jpeg", "png", "svg", "webp", "gif"].includes(extension)) return <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50"><Image src={signedUrl} alt={drawing.title} width={1600} height={900} unoptimized className="max-h-[520px] h-auto w-full object-contain" /></div>;
  return <div className="overflow-hidden rounded-2xl border border-slate-200"><iframe src={signedUrl} title={drawing.title} className="h-[520px] w-full bg-white" /></div>;
}
