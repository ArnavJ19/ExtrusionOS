"use server";

// Autopilot batch 9 server actions that read something before the database records it: AP-008 parses a pasted WhatsApp
// enquiry and resolves its codes, AP-009 reads back an uploaded register photo (hash, size) and opens a draft against the
// shift's jobs, and AP-048 reads back an uploaded DXF drawing and measures it. Each one writes only a draft or a proposal
// through its database gateway, which re-checks the company, the actor and the role.
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ENQUIRY_ROLES, GEOMETRY_UPLOADERS, REGISTER_ROLES, enquiryLineSchema, enquirySaveSchema } from "@/lib/autopilot-batch9/commands";
import { parseEnquiry, resolveLine, type CodeResolution } from "@/lib/quotes/enquiry-parser";
import { geometrySvg, readDxf } from "@/lib/geometry/dxf";

type Result<T> = { success: true; data: T } | { success: false; error: string };
const MAX_DXF = 8 * 1024 * 1024; const MAX_PHOTO = 10 * 1024 * 1024;

const message = (error: { code?: string; message?: string } | null) => error?.code === "P0001" && error.message?.startsWith("AP: ") ? error.message.slice(4)
  : error?.code === "42501" ? "This action is not available to your role."
  : ["PGRST202", "42883"].includes(error?.code ?? "") ? "This needs the Autopilot batch 9 database upgrade." : "The request could not be completed. Retry in a moment.";
function refresh(path: string) { try { revalidatePath(path); } catch { /* the database outcome stands */ } }

const pasteSchema = z.object({ text: z.string().min(3, "Paste the enquiry").max(20000, "The enquiry is longer than 20,000 characters"), customer_id: z.string().uuid().optional() }).strict();

/** AP-008: parse the pasted text, resolve every code for the customer (phone, name or chosen) and save the draft enquiry. */
export async function pasteEnquiryAction(input: z.infer<typeof pasteSchema>): Promise<Result<{ id: string; lines: number; high: number; unknown: number }>> {
  try {
    const ctx = await getSessionContext();
    if (ctx.dealerId || !(ENQUIRY_ROLES as readonly string[]).includes(ctx.role)) return { success: false, error: "Enquiries are prepared by sales." };
    const parsed = pasteSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Paste the enquiry." };
    const enquiry = parseEnquiry(parsed.data.text);
    if (!enquiry.lines.length) return { success: false, error: "No item could be found in this message. Check that it lists profile codes with quantities." };
    const supabase = await createClient();
    const codes = [...new Set(enquiry.lines.map(l => l.code_key).filter((k): k is string => Boolean(k)))];
    const context = await supabase.rpc("ap_enquiry", { p_command: "context", p_payload: { codes, ...(enquiry.sender_phone ? { phone: enquiry.sender_phone } : {}),
      ...(enquiry.sender_name ? { name: enquiry.sender_name } : {}), ...(parsed.data.customer_id ? { customer_id: parsed.data.customer_id } : {}) } });
    if (context.error) return { success: false, error: message(context.error) };
    const resolved = context.data as { customer: { id: string; basis: "phone" | "name" | "chosen" } | null; codes: Record<string, CodeResolution> };
    const lines = enquiry.lines.map(line => resolveLine(line, line.code_key ? resolved.codes[line.code_key] : null));
    const unknown = [...new Set(lines.filter(l => l.code_key && !l.profile_id).map(l => l.code_key as string))];
    const draft = enquirySaveSchema.safeParse({ raw_text: parsed.data.text, source: enquiry.source, ...(enquiry.sender_phone ? { sender_phone: enquiry.sender_phone } : {}),
      ...(enquiry.sender_name ? { sender_name: enquiry.sender_name } : {}), ...(resolved.customer ? { customer_id: resolved.customer.id, customer_basis: resolved.customer.basis } : {}),
      lines: lines.map(l => enquiryLineSchema.parse({ seq: l.seq, text: l.text, code: l.code, code_key: l.code_key, profile_id: l.profile_id, profile_code: l.profile_code, basis: l.basis,
        length_m: l.length_m, length_text: l.length_text, pieces: l.pieces, kg: l.kg, finish: l.finish, shade: l.shade, alloy: l.alloy, confidence: l.confidence, issues: l.issues })),
      unknown_codes: unknown });
    if (!draft.success) return { success: false, error: "The enquiry could not be read into a draft." };
    const saved = await supabase.rpc("ap_enquiry", { p_command: "save", p_payload: draft.data });
    if (saved.error) return { success: false, error: message(saved.error) };
    refresh("/quotes/enquiries");
    return { success: true, data: { id: (saved.data as { id: string }).id, lines: lines.length, high: lines.filter(l => l.confidence === "high").length, unknown: unknown.length } };
  } catch {
    return { success: false, error: "The enquiry could not be read. Check your session and retry." };
  }
}

const draftItemSchema = z.object({ seq: z.number(), profile_id: z.string().uuid(), profile_code: z.string(), item_description: z.string(), quantity_pieces: z.number().int().positive(),
  length_per_piece_m: z.number().positive(), section_weight_kg_per_m: z.number().positive(), billet_rate_per_kg: z.number().min(0), billet_rate_found: z.boolean(),
  conversion_charge_per_kg: z.number().min(0), finishing_type: z.string(), finishing_charge_type: z.enum(["per_kg", "per_sqft"]), finishing_charge: z.number().min(0),
  finishing_rate_found: z.boolean(), packing_charge: z.number(), transport_charge: z.number(), margin_percent: z.number(), minimum_margin_percent: z.number(), gst_percent: z.number(), confidence: z.string() }).passthrough();
const draftSchema = z.object({ enquiry_id: z.string().uuid(), enquiry_number: z.string(), customer: z.object({ id: z.string().uuid(), customer_name: z.string(), company_name: z.string().nullable(),
  gst_number: z.string().nullable(), billing_address: z.string().nullable(), shipping_address: z.string().nullable() }).passthrough(), items: z.array(draftItemSchema).max(100),
  skipped: z.array(z.object({ seq: z.unknown(), text: z.string().nullable(), reason: z.string() }).passthrough()), gst_percent: z.number(), validity_days: z.number(), notes: z.string() }).passthrough();
export type EnquiryQuoteDraft = z.infer<typeof draftSchema> & { profiles: Record<string, unknown>[] };

/** AP-008: the quotation form opens with the enquiry's lines; every price comes from today's approved rates and the normal calculation on save. */
export async function enquiryQuoteDraftAction(id: string): Promise<Result<EnquiryQuoteDraft>> {
  try {
    const ctx = await getSessionContext();
    if (ctx.dealerId || !["owner", "admin"].includes(ctx.role)) return { success: false, error: "Only owners and admins prepare priced quotations." };
    const supabase = await createClient();
    const out = await supabase.rpc("ap_enquiry", { p_command: "draft", p_payload: { id: z.string().uuid().parse(id) } });
    if (out.error) return { success: false, error: message(out.error) };
    const draft = draftSchema.parse(out.data);
    const ids = [...new Set(draft.items.map(i => i.profile_id))];
    const profiles = ids.length ? await supabase.from("aluminium_profiles").select("id, profile_code, profile_name, section_weight_kg_per_m, section_perimeter_mm, drawing_revision, drawing_approval_status")
      .eq("company_id", ctx.companyId).in("id", ids).limit(100) : { data: [], error: null };
    if (profiles.error) return { success: false, error: "The enquiry's profiles could not be read." };
    return { success: true, data: { ...draft, profiles: (profiles.data ?? []) as Record<string, unknown>[] } };
  } catch {
    return { success: false, error: "The enquiry could not be opened as a quotation." };
  }
}

/** AP-008: after the quotation was saved from the enquiry, the enquiry records it (and the remembered mappings their use). */
export async function linkEnquiryQuoteAction(id: string, quoteId: string): Promise<Result<{ status: string }>> {
  try {
    const ctx = await getSessionContext();
    if (ctx.dealerId) return { success: false, error: "Not available." };
    const supabase = await createClient();
    const out = await supabase.rpc("ap_enquiry", { p_command: "link_quote", p_payload: { id: z.string().uuid().parse(id), quote_id: z.string().uuid().parse(quoteId) } });
    if (out.error) return { success: false, error: message(out.error) };
    refresh("/quotes/enquiries");
    return { success: true, data: { status: (out.data as { status: string }).status } };
  } catch {
    return { success: false, error: "The quotation was saved, but the enquiry could not be marked as quoted." };
  }
}

const registerSchema = z.object({ machine_id: z.string().uuid(), shift_day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), shift_name: z.string().trim().max(40).optional(), template_id: z.string().uuid().optional(),
  storage_path: z.string().min(10).max(400), file_name: z.string().trim().min(1).max(200), mime_type: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]) }).strict();

/**
 * AP-009: the register photo was uploaded to the company's folder by the person's own session. It is read back, hashed
 * (the same photo cannot be captured twice) and a draft is opened with one row per job that ran on the press in that
 * shift. No vision provider is configured, so cells the system does not already know stay blank for the supervisor to
 * type from the photo; they are marked "typed" when confirmed.
 */
export async function createRegisterCaptureAction(input: z.infer<typeof registerSchema>): Promise<Result<{ id: string }>> {
  try {
    const ctx = await getSessionContext();
    if (ctx.dealerId || !(REGISTER_ROLES as readonly string[]).includes(ctx.role)) return { success: false, error: "Shift registers are captured by production." };
    const parsed = registerSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Review the register details." };
    const v = parsed.data;
    if (!v.storage_path.startsWith(`${ctx.companyId}/register-photos/`) || v.storage_path.includes("..")) return { success: false, error: "Upload the photo again." };
    const supabase = await createClient();
    const file = await supabase.storage.from("documents").download(v.storage_path);
    if (file.error || !file.data) return { success: false, error: "The uploaded photo could not be read back. Upload it again." };
    const bytes = new Uint8Array(await file.data.arrayBuffer());
    if (bytes.byteLength > MAX_PHOTO) return { success: false, error: "The photo is larger than 10 MB." };
    const sha = createHash("sha256").update(bytes).digest("hex");
    const out = await supabase.rpc("ap_register", { p_command: "create", p_payload: { ...v, file_sha256: sha } });
    if (out.error) return { success: false, error: message(out.error) };
    refresh("/production/registers");
    return { success: true, data: { id: (out.data as { id: string }).id } };
  } catch {
    return { success: false, error: "The register could not be captured. Check your session and retry." };
  }
}

/** A short-lived link to a stored register photo or drawing, through the person's own storage access. */
export async function storedFileUrlAction(kind: "register" | "drawing", id: string): Promise<Result<{ url: string }>> {
  try {
    const ctx = await getSessionContext();
    if (ctx.dealerId) return { success: false, error: "Not available." };
    const supabase = await createClient();
    const read = kind === "register" ? await supabase.rpc("ap_register", { p_command: "get", p_payload: { id: z.string().uuid().parse(id) } })
      : await supabase.rpc("ap_geometry", { p_command: "get", p_payload: { id: z.string().uuid().parse(id) } });
    if (read.error) return { success: false, error: message(read.error) };
    const path = (read.data as { storage_path: string }).storage_path;
    if (!path.startsWith(`${ctx.companyId}/`)) return { success: false, error: "The file is not available." };
    const signed = await supabase.storage.from("documents").createSignedUrl(path, 300);
    if (signed.error || !signed.data) return { success: false, error: "The file is not available." };
    return { success: true, data: { url: signed.data.signedUrl } };
  } catch {
    return { success: false, error: "The file is not available." };
  }
}

const drawingSchema = z.object({ profile_id: z.string().uuid(), storage_path: z.string().min(10).max(400), file_name: z.string().trim().min(1).max(200) }).strict();

/** AP-048: read back the uploaded DXF, measure its closed outlines and propose kg/m and perimeter to the profile master. */
export async function readProfileDrawingAction(input: z.infer<typeof drawingSchema>): Promise<Result<{ id: string; status: string; kg_per_m: number | null; warnings: string[] }>> {
  try {
    const ctx = await getSessionContext();
    if (ctx.dealerId || !(GEOMETRY_UPLOADERS as readonly string[]).includes(ctx.role)) return { success: false, error: "Drawings are read by production, quality or the plant head." };
    const parsed = drawingSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Review the drawing." };
    const v = parsed.data;
    if (!v.storage_path.startsWith(`${ctx.companyId}/profile-drawings/`) || v.storage_path.includes("..")) return { success: false, error: "Upload the drawing again." };
    if (!/\.dxf$/i.test(v.file_name)) return { success: false, error: "Upload the section as a DXF file." };
    const supabase = await createClient();
    const file = await supabase.storage.from("documents").download(v.storage_path);
    if (file.error || !file.data) return { success: false, error: "The uploaded drawing could not be read back. Upload it again." };
    const bytes = new Uint8Array(await file.data.arrayBuffer());
    if (bytes.byteLength > MAX_DXF) return { success: false, error: "The drawing is larger than 8 MB." };
    const sha = createHash("sha256").update(bytes).digest("hex");
    const result = readDxf(new TextDecoder("utf-8", { fatal: false }).decode(bytes));
    const geometry = result.ok ? { units: result.geometry.units, outer_area_mm2: result.geometry.outer_area_mm2, void_area_mm2: result.geometry.void_area_mm2,
      outer_perimeter_mm: result.geometry.outer_perimeter_mm, void_count: result.geometry.void_count, entity_count: result.geometry.entity_count, warnings: result.geometry.warnings.slice(0, 10) }
      : { units: "unknown", entity_count: result.entity_count, warnings: [result.error, ...result.warnings].slice(0, 10) };
    const svg = result.ok ? geometrySvg(result.geometry) : "";
    const out = await supabase.rpc("ap_geometry", { p_command: "draft", p_payload: { profile_id: v.profile_id, file_name: v.file_name, storage_path: v.storage_path, file_sha256: sha,
      geometry, ...(svg && svg.length <= 300000 ? { preview_svg: svg } : {}) } });
    if (out.error) return { success: false, error: message(out.error) };
    refresh(`/profiles/${v.profile_id}`);
    const row = out.data as { id: string; status: string; kg_per_m: number | null; warnings: string[] };
    return { success: true, data: { id: row.id, status: row.status, kg_per_m: row.kg_per_m, warnings: result.ok ? result.geometry.warnings : [result.error, ...result.warnings] } };
  } catch {
    return { success: false, error: "The drawing could not be read. Check your session and retry." };
  }
}
