import { technicalLineItemSchema } from "../validations/pcda/line-item.ts";
import { TECHNICAL_LINE_ITEM_FIELDS } from "./field-map.ts";

type QuoteProfileSnapshot = {
  id: string;
  profile_code?: string | null;
  profile_name?: string | null;
  section_number?: string | null;
  section_code?: string | null;
  section_name?: string | null;
  drawing_document_id?: string | null;
  drawing_revision?: string | null;
  drawing_approval_status?: string | null;
  alloy_standard_id?: string | null;
  alloy_id?: string | null;
  temper_id?: string | null;
  min_weight?: number | null;
  max_weight?: number | null;
  weight_tolerance?: number | null;
  actual_weight_kg_per_m?: number | null;
  standard_length?: number | null;
  bundle_quantity?: number | null;
  pieces_per_m_per_kg_per_bundle?: number | null;
};

type CalculatedQuoteItemSnapshot = {
  item_description?: string | null;
  quantity_pieces: number;
  length_per_piece_m: number;
  section_weight_kg_per_m: number;
  total_meters: number;
  total_weight_kg: number;
  billing_weight_kg: number;
  billet_rate_per_kg: number;
  raw_material_cost: number;
  conversion_charge_per_kg: number;
  conversion_cost: number;
  finishing_charge: number;
  finishing_cost: number;
  die_charge: number;
  die_amortization_amount: number;
  packing_charge: number;
  transport_charge: number;
  other_charges: number;
  margin_amount: number;
  line_total_before_gst: number;
  price_per_kg: number;
  sales_price_override?: number | null;
  minimum_billing_weight_kg?: number | null;
};

type QuoteItemPcdaInput = {
  companyId: string;
  profile: QuoteProfileSnapshot;
  item: CalculatedQuoteItemSnapshot;
  gstPercent: number;
  quoteRevisionNumber?: number | null;
};

export function normalizeDrawingApprovalStatus(status: string | null | undefined): "Pending" | "Approved" | "Rejected" | null {
  if (!status) return null;
  const normalized = status.toLowerCase();
  if (normalized === "approved") return "Approved";
  if (normalized === "rejected") return "Rejected";
  return "Pending";
}

export function buildQuoteItemPcdaFields(input: QuoteItemPcdaInput) {
  const { companyId, profile, item, gstPercent, quoteRevisionNumber } = input;
  const validated = technicalLineItemSchema.parse({
    company_id: companyId,
    section_number: profile.section_number ?? profile.profile_code ?? null,
    section_code: profile.section_code ?? profile.profile_code ?? null,
    section_name: profile.section_name ?? profile.profile_name ?? null,
    component_description: item.item_description ?? profile.profile_name ?? null,
    drawing_document_id: profile.drawing_document_id ?? null,
    drawing_revision: profile.drawing_revision ?? null,
    drawing_approval_status: normalizeDrawingApprovalStatus(profile.drawing_approval_status),
    alloy_standard_id: profile.alloy_standard_id ?? null,
    alloy_id: profile.alloy_id ?? null,
    temper_id: profile.temper_id ?? null,
    cl_uom: "m",
    cl_per_uom: item.length_per_piece_m,
    cl_meter: item.length_per_piece_m,
    order_uom: "piece",
    order_quantity: item.quantity_pieces,
    quantity_kg: item.total_weight_kg,
    section_weight_kg_per_m: item.section_weight_kg_per_m,
    min_weight: profile.min_weight ?? null,
    max_weight: profile.max_weight ?? null,
    weight_tolerance: profile.weight_tolerance ?? null,
    quantity_calculation_method: "length_weight_qty",
    invoice_calc_uom: "kg",
    standard_length: profile.standard_length ?? item.length_per_piece_m,
    cut_length: item.length_per_piece_m,
    bundle_quantity: profile.bundle_quantity ?? null,
    pieces_per_m_per_kg_per_bundle: profile.pieces_per_m_per_kg_per_bundle ?? null,
    material_price: item.billet_rate_per_kg || null,
    value_added_service_price: (item.conversion_charge_per_kg + item.finishing_charge) || null,
    other_charges: item.other_charges || null,
    basic_price: item.price_per_kg || null,
    packing_charge: item.packing_charge || null,
    freight_charge: item.transport_charge || null,
    die_cost: item.die_charge || null,
    die_service_charge: item.die_amortization_amount || null,
    packing_in_conversion: false,
    include_packing_in_basic: false,
    gst_percent: gstPercent,
    discount: null,
    margin: item.margin_amount,
    net_rate: item.price_per_kg || null,
    final_line_value: item.line_total_before_gst || null,
    theoretical_weight: item.total_weight_kg,
    actual_weight: null,
    internal_cost: (item.raw_material_cost + item.conversion_cost + item.finishing_cost + item.die_amortization_amount) || null,
    supplier_rate: null,
    internal_note: null,
    revision_number: quoteRevisionNumber ?? 1,
  });

  const lineFields: Record<string, unknown> = { ...validated };
  delete lineFields.id;
  delete lineFields.company_id;
  return lineFields;
}

export function buildOrderItemFromQuoteItem(quoteItem: Record<string, unknown>, orderId: string, quoteId: string, companyId: string) {
  const orderItem: Record<string, unknown> = {
    order_id: orderId,
    company_id: companyId,
    profile_id: quoteItem.profile_id ?? null,
    die_id: quoteItem.die_id ?? null,
    item_description: quoteItem.item_description ?? null,
    quantity_pieces: quoteItem.quantity_pieces ?? null,
    length_per_piece_m: quoteItem.length_per_piece_m ?? null,
    total_meters: quoteItem.total_meters ?? null,
    source_record_id: quoteId,
    source_line_id: quoteItem.id,
    revision_number: 1,
  };

  for (const field of TECHNICAL_LINE_ITEM_FIELDS) {
    if (field === "id" || field === "company_id" || field === "source_record_id" || field === "source_line_id" || field === "revision_number") continue;
    if (field in quoteItem) orderItem[field] = quoteItem[field];
  }

  return orderItem;
}

export function hasUnapprovedDrawing(line: { drawing_approval_status?: string | null }) {
  return normalizeDrawingApprovalStatus(line.drawing_approval_status) !== "Approved";
}
