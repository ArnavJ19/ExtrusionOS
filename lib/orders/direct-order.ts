import { z } from "zod";

const decimal = (minimum: number, maximum: number, places: number) => z.number().finite().min(minimum).max(maximum)
  .refine(value => Math.abs(value - Number(value.toFixed(places))) <= Number.EPSILON * Math.max(1, Math.abs(value)) * 4, `Use at most ${places} decimal places`)
  .transform(value => Number(value.toFixed(places)));
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date")
  .refine(value => { const parsed = new Date(`${value}T00:00:00Z`); return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value; }, "Enter a valid date");

export const directOrderLineSchema = z.object({
  profile_id: z.string().uuid("Select a profile"),
  die_id: z.string().uuid().nullable().default(null),
  quantity_pieces: z.number().int().min(1).max(1000000),
  length_per_piece_m: decimal(0.001, 1000, 3),
  expected_section_weight_kg_per_m: decimal(0.001, 10000, 3),
  net_rate: decimal(0.01, 10000000, 2),
  gst_percent: decimal(0, 100, 2),
  hsn_code: z.string().trim().regex(/^(?:\d{4}|\d{6}|\d{8})$/, "Enter a 4, 6 or 8 digit HSN code"),
  finishing_type: z.enum(["mill_finish", "powder_coating", "anodizing", "anodized_silver", "anodized_bronze", "anodized_black", "wood_finish", "wood_grain", "pvdf", "other"])
}).strict();

export const directOrderSchema = z.object({
  idempotency_key: z.string().uuid(),
  order: z.object({
    customer_id: z.string().uuid("Select a customer"),
    order_date: date,
    expected_dispatch_date: date.nullable().default(null),
    priority: z.enum(["low", "normal", "high", "urgent"]),
    notes: z.string().trim().max(2000).default("")
  }).strict().refine(value => !value.expected_dispatch_date || value.expected_dispatch_date >= value.order_date,
    { message: "Expected dispatch cannot be before the order date", path: ["expected_dispatch_date"] }),
  items: z.array(directOrderLineSchema).min(1, "Add at least one priced profile line").max(100)
}).strict();

export type DirectOrderInput = z.input<typeof directOrderSchema>;
export type DirectOrderLine = z.infer<typeof directOrderLineSchema>;
export type DirectOrderProfile = { id: string; profile_code: string; profile_name: string; section_weight_kg_per_m: number; hsn_code: string | null };
export type DirectOrderCustomer = { id: string; customer_name: string; company_name: string | null };

export function canCreateDirectOrder(role: string, dealerId?: string | null) {
  return !dealerId && ["owner", "admin", "sales_manager", "sales"].includes(role);
}

// Integer thousandths and paise mirror PostgreSQL's positive numeric rounding.
export function calculateDirectOrderLine(input: DirectOrderLine, sectionWeightKgPerM: number) {
  const line = directOrderLineSchema.parse(input);
  decimal(0.001, 10000, 3).parse(sectionWeightKgPerM);
  if (line.expected_section_weight_kg_per_m !== sectionWeightKgPerM) throw new Error("Refresh the profile section weight and review this line.");
  const round = (value: bigint, divisor: bigint) => (value + divisor / BigInt(2)) / divisor;
  const metres = BigInt(line.quantity_pieces) * BigInt(Math.round(line.length_per_piece_m * 1000));
  const kilograms = round(metres * BigInt(Math.round(sectionWeightKgPerM * 1000)), BigInt(1000));
  const subtotal = round(kilograms * BigInt(Math.round(line.net_rate * 100)), BigInt(1000));
  const tax = round(subtotal * BigInt(Math.round(line.gst_percent * 100)), BigInt(10000));
  if (kilograms <= BigInt(0) || kilograms > BigInt(99999999999) || subtotal <= BigInt(0) || subtotal + tax > BigInt(99999999999999)) {
    throw new Error("This line is too small or too large to bill. Check its pieces, length and rate.");
  }
  return { total_meters: Number(metres) / 1000, quantity_kg: Number(kilograms) / 1000,
    subtotal: Number(subtotal) / 100, tax: Number(tax) / 100, grand_total: Number(subtotal + tax) / 100 };
}

export function calculateDirectOrderSummary(lines: ReturnType<typeof calculateDirectOrderLine>[]) {
  const weight = lines.reduce((sum, line) => sum + Math.round(line.quantity_kg * 1000), 0) / 1000;
  const subtotal = lines.reduce((sum, line) => sum + Math.round(line.subtotal * 100), 0) / 100;
  const tax = lines.reduce((sum, line) => sum + Math.round(line.tax * 100), 0) / 100;
  const total = (Math.round(subtotal * 100) + Math.round(tax * 100)) / 100;
  return { weight, subtotal, tax, total, within_limits: weight <= 99999999.999 && total <= 999999999999.99 };
}
