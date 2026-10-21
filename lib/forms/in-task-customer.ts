import { z } from "zod";
import { customerSchema } from "../validations/schemas";

export const inTaskCustomerSchema = customerSchema.pick({
  customer_name: true, company_name: true, customer_type: true, phone: true,
  email: true, gst_number: true, billing_address: true, shipping_address: true,
  city: true, state: true, pincode: true,
}).strict().superRefine((value, context) => {
  for (const [field, text] of Object.entries(value)) {
    if (typeof text === "string" && text.length > (field.endsWith("address") ? 1000 : 160)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `${field.replaceAll("_", " ")} is too long for quick customer entry.` });
    }
  }
});

export type InTaskCustomerInput = z.input<typeof inTaskCustomerSchema>;
export type InTaskCustomerData = z.output<typeof inTaskCustomerSchema>;
export type InTaskCustomerOption = {
  id: string; customer_name: string; company_name: string | null; customer_type: string;
  phone: string | null; email: string | null; gst_number: string | null;
  billing_address: string | null; shipping_address: string | null; city: string | null;
  is_active: boolean;
};
export type InTaskCustomerMatch = Pick<InTaskCustomerOption, "id" | "customer_name" | "company_name" | "phone" | "gst_number" | "is_active"> & { matched_on: string[] };
export type InTaskCustomerResult =
  | { kind: "checked" | "similar"; matches: InTaskCustomerMatch[]; hasMore: boolean }
  | { kind: "created" | "selected"; customer: InTaskCustomerOption }
  | { kind: "error"; error: string; uncertain?: boolean };

export const inTaskCustomerRequestSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("check"), customer: inTaskCustomerSchema }).strict(),
  z.object({ intent: z.literal("create"), customer: inTaskCustomerSchema, request_id: z.string().uuid(), acknowledge_similar: z.boolean().default(false) }).strict(),
  z.object({ intent: z.literal("select"), customer_id: z.string().uuid() }).strict(),
]);
export type InTaskCustomerRequest = z.input<typeof inTaskCustomerRequestSchema>;

export const inTaskCustomerDefaults: InTaskCustomerInput = {
  customer_name: "", company_name: "", customer_type: "fabricator", phone: "", email: "",
  gst_number: "", billing_address: "", shipping_address: "", city: "", state: "", pincode: "",
};

export function customerNamePattern(value: string) {
  return `%${value.trim().replace(/[\\%_]/g, "\\$&").replace(/\s+/g, "%")}%`;
}

export function normalizedCustomerPhone(value: string | null | undefined) {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits.length === 11 && digits.startsWith("0") ? digits.slice(1) : digits;
}

export function customerPhonePattern(value: string) {
  const national = normalizedCustomerPhone(value);
  return `%${national.split("").join("%")}%`;
}

export function sameCustomerRequest(row: Record<string, unknown>, customer: InTaskCustomerData, userId: string) {
  return row.created_by === userId && Object.entries(customer).every(([field, value]) => (row[field] ?? null) === (value ?? null));
}

export function customerOption(row: Record<string, any>): InTaskCustomerOption {
  return {
    id: row.id, customer_name: row.customer_name, company_name: row.company_name ?? null,
    customer_type: row.customer_type, phone: row.phone ?? null, email: row.email ?? null,
    gst_number: row.gst_number ?? null, billing_address: row.billing_address ?? null,
    shipping_address: row.shipping_address ?? null, city: row.city ?? null, is_active: row.is_active === true,
  };
}

export function customerMatchOption(row: Record<string, any>): Omit<InTaskCustomerMatch, "matched_on"> {
  return { id: row.id, customer_name: row.customer_name, company_name: row.company_name ?? null, phone: row.phone ?? null, gst_number: row.gst_number ?? null, is_active: row.is_active === true };
}
