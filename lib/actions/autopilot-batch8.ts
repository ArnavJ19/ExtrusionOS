"use server";

// Autopilot batch 8 server action that reads a file before the database records anything: AP-020 reads an uploaded billet
// mill test certificate (already stored under the company's folder by the person's own session) into a draft. The file is
// read back through the same session, hashed, and its text layer parsed; a photo or a scan with no text keeps every field
// blank for the person to type. The draft never accepts material.
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { MTC_UPLOADERS, mtcDraftSchema } from "@/lib/autopilot-batch8/commands";
import { extractMtc, MTC_FIELD_KEYS, type MtcExtraction } from "@/lib/quality/mtc-extract";
import { extractPdfText } from "@/lib/pdf/text-extract";

type Result<T> = { success: true; data: T } | { success: false; error: string };
const MAX_BYTES = 10 * 1024 * 1024;

const readSchema = z.object({
  receipt_line_id: z.string().uuid().optional(), billet_batch_id: z.string().uuid().optional(),
  storage_path: z.string().min(10).max(400), file_name: z.string().trim().min(1).max(200),
  mime_type: z.enum(["application/pdf", "image/png", "image/jpeg", "image/webp"]),
  pasted_text: z.string().max(20000).optional()
}).strict().refine(v => Boolean(v.receipt_line_id) !== Boolean(v.billet_batch_id), { message: "Choose the received line or the billet batch" });

const message = (error: { code?: string; message?: string } | null) => error?.code === "P0001" && error.message?.startsWith("AP: ") ? error.message.slice(4)
  : error?.code === "42501" ? "This action is not available to your role." : "The certificate could not be saved. Retry in a moment.";

export async function readCertificateAction(input: z.infer<typeof readSchema>): Promise<Result<{ id: string; read: number; source_kind: string }>> {
  try {
    const ctx = await getSessionContext();
    if (ctx.dealerId || !(MTC_UPLOADERS as readonly string[]).includes(ctx.role)) return { success: false, error: "Certificates are recorded by quality, stores or the plant head." };
    const parsed = readSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Review the certificate details." };
    const v = parsed.data;
    if (!v.storage_path.startsWith(`${ctx.companyId}/`) || v.storage_path.includes("..")) return { success: false, error: "Upload the certificate again." };
    const supabase = await createClient();
    const target = await supabase.rpc("ap_mtc", { p_command: "target", p_payload: v.receipt_line_id ? { receipt_line_id: v.receipt_line_id } : { billet_batch_id: v.billet_batch_id } });
    if (target.error) return { success: false, error: message(target.error) };
    const file = await supabase.storage.from("documents").download(v.storage_path);
    if (file.error || !file.data) return { success: false, error: "The uploaded certificate could not be read back. Upload it again." };
    const bytes = new Uint8Array(await file.data.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES) return { success: false, error: "The certificate is larger than 10 MB." };
    const sha = createHash("sha256").update(bytes).digest("hex");
    let text: string | null = null; let source: "pdf_text" | "pdf_no_text" | "photo" | "pasted_text";
    if (v.pasted_text?.trim()) { text = v.pasted_text; source = "pasted_text"; }
    else if (v.mime_type === "application/pdf") { text = extractPdfText(bytes); source = text ? "pdf_text" : "pdf_no_text"; }
    else source = "photo";
    const template = (target.data as { template?: { heat_labels: string[]; alloy_labels: string[]; element_order: string[]; decimal_comma: boolean } | null })?.template ?? null;
    const extraction: MtcExtraction = text ? extractMtc(text, template) : Object.fromEntries(MTC_FIELD_KEYS.map(k => [k, { value: null, confidence: null, source: null }])) as MtcExtraction;
    const draft = mtcDraftSchema.safeParse({
      ...(v.receipt_line_id ? { receipt_line_id: v.receipt_line_id } : { billet_batch_id: v.billet_batch_id }), file_name: v.file_name, storage_path: v.storage_path, mime_type: v.mime_type,
      file_sha256: sha, source_kind: source, extracted: extraction
    });
    if (!draft.success) return { success: false, error: "The certificate could not be read into a draft." };
    const saved = await supabase.rpc("ap_mtc", { p_command: "draft", p_payload: draft.data });
    if (saved.error) return { success: false, error: message(saved.error) };
    try { revalidatePath("/quality/certificates"); } catch { /* the database outcome stands */ }
    return { success: true, data: { id: (saved.data as { id: string }).id, read: MTC_FIELD_KEYS.filter(k => extraction[k].value !== null).length, source_kind: source } };
  } catch {
    return { success: false, error: "The certificate could not be read. Check your session and retry." };
  }
}

/** A short-lived link to the stored certificate, through the person's own storage access. */
export async function certificateFileUrlAction(id: string): Promise<Result<{ url: string }>> {
  try {
    const ctx = await getSessionContext();
    if (ctx.dealerId) return { success: false, error: "Not available." };
    const supabase = await createClient();
    const read = await supabase.rpc("ap_mtc", { p_command: "get", p_payload: { id: z.string().uuid().parse(id) } });
    if (read.error) return { success: false, error: message(read.error) };
    const path = (read.data as { storage_path: string }).storage_path;
    const signed = await supabase.storage.from("documents").createSignedUrl(path, 300);
    if (signed.error || !signed.data) return { success: false, error: "The certificate file is not available." };
    return { success: true, data: { url: signed.data.signedUrl } };
  } catch {
    return { success: false, error: "The certificate file is not available." };
  }
}
