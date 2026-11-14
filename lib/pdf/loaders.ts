// Server-only: load one record through the signed-in user's own client (RLS applies) and build its PDF. Used by the
// single-document routes and by AP-091 "Print selected", so a record prints the same way alone or in a batch, and a
// batch is authorised record by record. The company always comes from the server session.
import type { createClient } from "@/lib/supabase/server";
import { buildInvoicePdf } from "@/lib/pdf/invoice-pdf";
import { buildQuotePdf } from "@/lib/pdf/quote-pdf";
import { buildChallanPdf, type ChallanBundle } from "@/lib/pdf/challan-pdf";
import { buildJobCardPdf, type JobCardCheck } from "@/lib/pdf/job-card-pdf";
import { companyLogo, loadCompanyLogo } from "@/lib/pdf/logo-loader-node";
import { qrRuns } from "@/lib/pdf/qr-modules";
import { buildQrPayloadV2 } from "@/lib/qr/payload";
import { getErrorMessage } from "@/lib/utils/errors";

type Client = Awaited<ReturnType<typeof createClient>>;
export type PdfContext = { companyId: string; userId: string; role: string };
export type PdfLoad = { ok: true; bytes: Uint8Array; filename: string; label: string } | { ok: false; status: number; error: string; label?: string };
export const PDF_KINDS = ["invoice", "quote", "challan", "job_card"] as const;
export type PdfKind = (typeof PDF_KINDS)[number];

const fail = (status: number, error: string, label?: string): PdfLoad => ({ ok: false, status, error, label });
const num = (value: unknown) => value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);
const one = <T,>(value: T | T[] | null | undefined): T | null => Array.isArray(value) ? value[0] ?? null : value ?? null;

export async function loadInvoicePdf(supabase: Client, ctx: PdfContext, id: string): Promise<PdfLoad> {
  const [invoice, items] = await Promise.all([
    supabase.from("invoices").select("invoice_number,invoice_date,due_date,amount_paid,credited_amount,balance_due,status,subtotal,tax_total,grand_total,supplier_state_code,place_of_supply_state_code,cgst_amount,sgst_amount,utgst_amount,igst_amount,supplier_snapshot,customer_snapshot").eq("company_id", ctx.companyId).eq("id", id).maybeSingle(),
    supabase.from("invoice_items_authorized").select("item_description,hsn_code,quantity,unit_rate,line_total,gst_percent").eq("company_id", ctx.companyId).eq("invoice_id", id).order("created_at"),
  ]);
  if (invoice.error || items.error) return fail(503, "Invoice data is unavailable. Please try again or contact your administrator to check the database deployment.");
  if (!invoice.data) return fail(404, "Invoice not found");
  const label = String(invoice.data.invoice_number ?? "Invoice");
  if (!invoice.data.supplier_snapshot || !invoice.data.customer_snapshot) return fail(409, "This legacy invoice predates party snapshots. Use its original issued document; current master details cannot verify the historical invoice.", label);
  // AP-082: an IRN recorded from the IRP prints with its signed QR. Readable only to finance roles; others get the invoice without it.
  const irnRead = await supabase.from("invoice_irns").select("irn,ack_no,ack_date,signed_qr").eq("company_id", ctx.companyId).eq("invoice_id", id).maybeSingle();
  const irn = irnRead.data ? { irn: irnRead.data.irn as string, ack_no: irnRead.data.ack_no as string, ack_date: irnRead.data.ack_date as string, qr: qrRuns(irnRead.data.signed_qr as string, "L") } : null;
  try {
    const bytes = await buildInvoicePdf({ company: invoice.data.supplier_snapshot, customer: invoice.data.customer_snapshot, invoice: invoice.data, items: items.data ?? [], logo: await companyLogo(supabase, ctx.companyId), irn });
    return { ok: true, bytes, filename: `invoice-${id}.pdf`, label };
  } catch {
    return fail(409, "Complete invoice supply states and line HSN codes before generating the PDF.", label);
  }
}

export async function loadQuotePdf(supabase: Client, ctx: PdfContext, id: string): Promise<PdfLoad> {
  const [companyResult, settingsResult, quoteResult, itemsResult] = await Promise.all([
    supabase.from("companies").select("name, legal_name, logo_url, gst_number, billing_address, city, state, pincode, phone, email").eq("id", ctx.companyId).single(),
    supabase.from("company_settings_authorized").select("default_quote_terms, default_terms_and_conditions, default_payment_terms, default_delivery_terms, bank_details, default_bank_details").eq("company_id", ctx.companyId).maybeSingle(),
    supabase.from("quotes_authorized").select("id, customer_id, quote_number, revision_number, status, quote_date, valid_until, subtotal, gst_percent, gst_amount, grand_total, terms_and_conditions, delivery_timeline, payment_terms").eq("company_id", ctx.companyId).eq("id", id).single(),
    supabase.from("quote_items_authorized").select("profile_id, quantity_pieces, length_per_piece_m, total_meters, total_weight_kg, billing_weight_kg, price_per_kg, price_per_meter, line_total_before_gst, net_rate, die_service_charge, freight_charge, item_description, finishing_type, finishing_charge_type, costing_complete").eq("company_id", ctx.companyId).eq("quote_id", id).order("created_at")
  ]);
  if (quoteResult.error || !quoteResult.data) return fail(404, "Quote not found");
  const label = String(quoteResult.data.quote_number ?? "Quotation");
  if (companyResult.error || !companyResult.data) return fail(404, "Company not found", label);
  if (settingsResult.error) return fail(500, getErrorMessage(settingsResult.error), label);
  if (itemsResult.error) return fail(500, getErrorMessage(itemsResult.error), label);
  if (!(itemsResult.data ?? []).length) return fail(409, "This quotation has no line items. Add items and recalculate before generating its PDF.", label);
  if ((itemsResult.data ?? []).some((item: any) => item.finishing_charge_type === "per_sqft" && !item.costing_complete)) return fail(409, "Add the missing profile perimeter and recalculate this quote before generating its PDF.", label);
  const profileIds = [...new Set((itemsResult.data ?? []).map((item: any) => item.profile_id).filter(Boolean))];
  const [customerResult, profilesResult] = await Promise.all([
    supabase.from("customers").select("customer_name, company_name, gst_number, billing_address, shipping_address").eq("company_id", ctx.companyId).eq("id", quoteResult.data.customer_id).single(),
    profileIds.length ? supabase.from("aluminium_profiles").select("id, profile_code, profile_name").eq("company_id", ctx.companyId).in("id", profileIds) : Promise.resolve({ data: [], error: null })
  ]);
  if (customerResult.error || !customerResult.data) return fail(404, "Quote customer not found", label);
  if (profilesResult.error) return fail(500, getErrorMessage(profilesResult.error), label);
  const profileById = new Map((profilesResult.data ?? []).map((profile: any) => [profile.id, profile]));
  const quote = { ...quoteResult.data, customers: customerResult.data };
  const items = (itemsResult.data ?? []).map((item: any) => ({ ...item, aluminium_profiles: profileById.get(item.profile_id) ?? null }));
  const bytes = await buildQuotePdf({ company: companyResult.data, settings: settingsResult.data, quote, items, logo: await loadCompanyLogo(companyResult.data.logo_url) });
  return { ok: true, bytes, filename: `${quoteResult.data.quote_number}.pdf`, label };
}

/** AP-091: delivery challan of one dispatch (no prices). */
export async function loadChallanPdf(supabase: Client, ctx: PdfContext, id: string): Promise<PdfLoad> {
  const dispatch = await supabase.from("dispatches").select("id, order_id, dispatch_number, dispatch_date, vehicle_number, transporter_name, driver_name, lr_number, eway_bill_number")
    .eq("company_id", ctx.companyId).eq("id", id).maybeSingle();
  if (dispatch.error) return fail(503, "Dispatch data is unavailable. Retry in a moment.");
  if (!dispatch.data) return fail(404, "Dispatch not found");
  const d = dispatch.data;
  const label = String(d.dispatch_number ?? "Dispatch");
  const [company, order, bundles] = await Promise.all([
    supabase.from("companies").select("name, legal_name, logo_url, gst_number, billing_address, city, state, pincode").eq("id", ctx.companyId).single(),
    d.order_id ? supabase.from("orders").select("order_number, order_date, customer_id, customers(customer_name, company_name, gst_number, shipping_address, billing_address, city, state, pincode)").eq("company_id", ctx.companyId).eq("id", d.order_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    supabase.from("packing_list_items").select("bundle_number, number_of_pieces, net_weight_kg, gross_weight_kg, tare_weight_kg, net_length_m, cut_length, component_description, aluminium_profiles(profile_code, profile_name)")
      .eq("company_id", ctx.companyId).eq("dispatch_id", id).order("bundle_number")
  ]);
  if (company.error || !company.data) return fail(404, "Company not found", label);
  if (order.error || bundles.error) return fail(503, "Dispatch details are unavailable. Retry in a moment.", label);
  const customer = one((order.data as any)?.customers) as any;
  const address = (c: any, field: string) => [c?.[field], c?.city, c?.state, c?.pincode].filter(Boolean).join(", ") || null;
  const rows: ChallanBundle[] = (bundles.data ?? []).map((b: any) => {
    const profile = one(b.aluminium_profiles) as any;
    const gross = num(b.gross_weight_kg), tare = num(b.tare_weight_kg);
    return { bundle_number: b.bundle_number ?? null, profile: profile?.profile_code ?? null, description: b.component_description ?? profile?.profile_name ?? null, pieces: num(b.number_of_pieces),
      length_m: num(b.cut_length) ?? (num(b.net_length_m) !== null && num(b.number_of_pieces) ? Number(b.net_length_m) / Number(b.number_of_pieces) : null),
      net_kg: num(b.net_weight_kg) ?? (gross !== null && tare !== null ? Math.round((gross - tare) * 1000) / 1000 : null), gross_kg: gross };
  });
  const bytes = await buildChallanPdf({
    company: { name: company.data.name, legal_name: company.data.legal_name, gst_number: company.data.gst_number, address: address(company.data, "billing_address") },
    customer: { name: customer ? customer.company_name || customer.customer_name : "Customer not recorded", gst_number: customer?.gst_number ?? null, address: address(customer, customer?.shipping_address ? "shipping_address" : "billing_address") },
    dispatch: { dispatch_number: label, dispatch_date: d.dispatch_date, vehicle_number: d.vehicle_number, transporter_name: d.transporter_name, driver_name: d.driver_name, lr_number: d.lr_number, eway_bill_number: d.eway_bill_number },
    order: { order_number: (order.data as any)?.order_number ?? null, order_date: (order.data as any)?.order_date ?? null },
    bundles: rows, logo: await loadCompanyLogo(company.data.logo_url)
  });
  return { ok: true, bytes, filename: `challan-${label}.pdf`, label };
}

/** The job's current QR label, or a new one when it has none (AP-096). A withdrawn label is never reused. */
async function jobQr(supabase: Client, ctx: PdfContext, jobId: string, label: string) {
  const active = await supabase.from("qr_codes").select("qr_value, expires_at").eq("company_id", ctx.companyId).eq("entity_type", "production_job").eq("entity_id", jobId).eq("status", "active")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (active.data?.qr_value && (!active.data.expires_at || new Date(active.data.expires_at).getTime() > Date.now() + 86400000)) return String(active.data.qr_value);
  const value = buildQrPayloadV2("production_job", jobId, crypto.randomUUID());
  const created = await supabase.from("qr_codes").insert({ company_id: ctx.companyId, entity_type: "production_job", entity_id: jobId, qr_value: value, status: "active",
    expires_at: new Date(Date.now() + 60 * 86400000).toISOString(), label, created_by: ctx.userId }).select("id").maybeSingle();
  // Without permission to issue a label the card still carries the version 2 code, which opens the job by its id.
  return created.error ? String(active.data?.qr_value ?? value) : value;
}

/** AP-096: one-page paper job card with a QR fallback. */
export async function loadJobCardPdf(supabase: Client, ctx: PdfContext, id: string): Promise<PdfLoad> {
  const job = await supabase.from("production_jobs").select("id, job_number, status, planned_date, shift, planned_quantity_kg, pieces, planned_meters, length_per_piece_m, cut_length, finishing_type, remarks, order_id, profile_id, die_id, machine_id, packing_instruction, pieces_per_bundle, kg_per_bundle, customer_packing_requirement, section_weight_kg_per_m")
    .eq("company_id", ctx.companyId).eq("id", id).maybeSingle();
  if (job.error) return fail(503, "Job data is unavailable. Retry in a moment.");
  if (!job.data) return fail(404, "Production job not found");
  const j = job.data as any;
  const label = String(j.job_number ?? "Job");
  if (["completed", "cancelled"].includes(j.status)) return fail(409, `Job ${label} is ${j.status}; a job card is printed only for jobs still to run.`, label);
  const [company, order, profile, die, machine, billet, draft] = await Promise.all([
    supabase.from("companies").select("name").eq("id", ctx.companyId).single(),
    j.order_id ? supabase.from("orders").select("order_number, expected_dispatch_date, customers(customer_name, company_name)").eq("company_id", ctx.companyId).eq("id", j.order_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    j.profile_id ? supabase.from("aluminium_profiles").select("profile_code, profile_name, alloy, temper, section_weight_kg_per_m, billet_diameter_mm, billet_diameter_required_inch, special_production_notes, pieces_per_bundle, kg_per_bundle").eq("company_id", ctx.companyId).eq("id", j.profile_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    j.die_id ? supabase.from("dies").select("die_number, number_of_cavities, die_status").eq("company_id", ctx.companyId).eq("id", j.die_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    j.machine_id ? supabase.from("machines").select("machine_name").eq("company_id", ctx.companyId).eq("id", j.machine_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    supabase.from("job_billet_length_choices").select("chosen_mm, recommended_mm, standard_mm").eq("company_id", ctx.companyId).eq("production_job_id", id).is("superseded_at", null).order("chosen_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("production_job_draft_lines").select("due_date").eq("company_id", ctx.companyId).eq("job_id", id).order("due_date").limit(1).maybeSingle()
  ]);
  if (company.error || !company.data) return fail(404, "Company not found", label);
  const p = profile.data as any, o = order.data as any, b = billet.data as any;
  // The approved inspection plan for the profile, else the company default (as quality entry uses it).
  const plans = await supabase.from("inspection_plans").select("id, profile_id, sampling_instruction, version").eq("company_id", ctx.companyId).eq("status", "approved")
    .or(j.profile_id ? `profile_id.eq.${j.profile_id},profile_id.is.null` : "profile_id.is.null");
  const plan = (plans.data ?? []).sort((x: any, y: any) => Number(x.profile_id === null) - Number(y.profile_id === null) || y.version - x.version)[0] as any;
  const items = plan ? await supabase.from("inspection_plan_items").select("seq, characteristic, unit, nominal, lower_limit, upper_limit, method, critical").eq("company_id", ctx.companyId).eq("plan_id", plan.id).order("seq") : { data: [] };
  const checks: JobCardCheck[] = (items.data ?? []).map((i: any) => ({ characteristic: i.characteristic, unit: i.unit, nominal: num(i.nominal), lower_limit: num(i.lower_limit), upper_limit: num(i.upper_limit), method: i.method ?? null, critical: Boolean(i.critical) }));
  const qrText = await jobQr(supabase, ctx, id, label);
  const customer = one(o?.customers) as any;
  const bytes = await buildJobCardPdf({
    company: { name: company.data.name },
    job: { job_number: label, status: j.status, planned_date: j.planned_date, shift: j.shift, machine: (machine.data as any)?.machine_name ?? null, order_number: o?.order_number ?? null,
      customer: customer ? customer.company_name || customer.customer_name : null, due_date: (draft.data as any)?.due_date ?? o?.expected_dispatch_date ?? null,
      planned_kg: num(j.planned_quantity_kg), pieces: num(j.pieces), planned_meters: num(j.planned_meters), cut_length_m: num(j.length_per_piece_m) ?? num(j.cut_length),
      finishing_type: j.finishing_type ?? null, remarks: j.remarks ?? null },
    profile: { code: p?.profile_code ?? null, name: p?.profile_name ?? null, kg_per_m: num(j.section_weight_kg_per_m) ?? num(p?.section_weight_kg_per_m), alloy: p?.alloy ?? null, temper: p?.temper ?? null, special_notes: p?.special_production_notes ?? null },
    die: { number: (die.data as any)?.die_number ?? null, cavities: num((die.data as any)?.number_of_cavities), status: (die.data as any)?.die_status ?? null },
    billet: { length_mm: num(b?.chosen_mm) ?? num(b?.recommended_mm) ?? num(b?.standard_mm), length_basis: b?.chosen_mm ? "chosen" : b?.recommended_mm ? "recommended" : b?.standard_mm ? "press standard" : null,
      diameter: num(p?.billet_diameter_mm) ? `${num(p?.billet_diameter_mm)} mm` : num(p?.billet_diameter_required_inch) ? `${num(p?.billet_diameter_required_inch)} inch` : null, alloy: p?.alloy ?? null },
    packing: { instruction: j.packing_instruction ?? null, pieces_per_bundle: num(j.pieces_per_bundle) ?? num(p?.pieces_per_bundle), kg_per_bundle: num(j.kg_per_bundle) ?? num(p?.kg_per_bundle), customer_requirement: j.customer_packing_requirement ?? null },
    checks, sampling: plan?.sampling_instruction ?? null,
    qr: { runs: qrRuns(qrText, "M"), text: qrText },
    printed_at: new Date()
  });
  return { ok: true, bytes, filename: `job-card-${label}.pdf`, label };
}

export async function loadPdf(kind: PdfKind, supabase: Client, ctx: PdfContext, id: string): Promise<PdfLoad> {
  if (kind === "invoice") return loadInvoicePdf(supabase, ctx, id);
  if (kind === "quote") return loadQuotePdf(supabase, ctx, id);
  if (kind === "challan") return loadChallanPdf(supabase, ctx, id);
  return loadJobCardPdf(supabase, ctx, id);
}
