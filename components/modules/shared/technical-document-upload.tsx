"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/browser";
import { removeTenantFile, uploadTenantFile } from "@/lib/utils/files";
import { getErrorMessage } from "@/lib/utils/errors";
import type { SessionContext } from "@/types/app";

const DOCUMENT_TYPES = [
  "die_drawing", "profile_drawing", "cad_file", "dxf_file", "dwg_file",
  "trial_report", "nitriding_certificate", "die_correction_report",
  "die_inspection_certificate", "material_test_certificate",
  "chemical_composition_certificate", "quality_inspection_report",
  "customer_approval_document", "production_route_sheet",
  "costing_sheet", "technical_data_sheet", "compliance_certificate", "other"
];

type Props = {
  context: SessionContext;
  entityType: string;
  entityId: string;
  onUploaded?: () => void;
};

export function TechnicalDocumentUpload({ context, entityType, entityId, onUploaded }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [uploading, setUploading] = useState(false);
  const [docType, setDocType] = useState("other");
  const [notes, setNotes] = useState("");

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);

    let storagePath: string | null = null;
    try {
      storagePath = await uploadTenantFile("documents", context.companyId, `${entityType}/${entityId}`, file);

      const { error } = await supabase.from("technical_documents").insert({
        company_id: context.companyId,
        document_type: docType,
        linked_entity_type: entityType,
        linked_entity_id: entityId,
        file_name: file.name,
        file_url: storagePath,
        storage_bucket: "documents",
        storage_path: storagePath,
        mime_type: file.type || null,
        uploaded_by: context.userId,
        approval_status: "pending",
        version_number: 1,
        notes: notes || null
      });

      if (error) {
        try {
          await removeTenantFile("documents", storagePath);
        } catch (cleanupError) {
          console.error("Could not remove orphaned technical document", cleanupError);
        }
        throw error;
      }
      toast.success(`Document "${file.name}" uploaded`);
      setNotes("");
      onUploaded?.();
    } catch (err) {
      toast.error(getErrorMessage(err, "Upload failed"));
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  return (
    <Card>
      <CardHeader><h2 className="section-title">Upload Technical Document</h2></CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="form-label">Document type</span>
            <select className="form-input" value={docType} onChange={(e) => setDocType(e.target.value)}>
              {DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</option>)}
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="form-label">Notes (optional)</span>
            <input className="form-input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Rev 3, customer spec" />
          </label>
        </div>
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-aluminium/30 p-6 transition hover:border-orange hover:bg-orange/5">
          <Upload className="h-5 w-5 text-slate-500" />
          <span className="text-sm font-bold text-slate-600">{uploading ? "Uploading..." : "Click to select file (PDF, Image, DXF, DWG — max 10 MB)"}</span>
          <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp,.dxf,.dwg,.csv,.xlsx" onChange={handleUpload} disabled={uploading} />
        </label>
      </CardContent>
    </Card>
  );
}
