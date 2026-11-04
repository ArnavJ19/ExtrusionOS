import { z } from "zod";
import { vendorSchema } from "../validations/schemas";
import { customerNamePattern, customerPhonePattern, normalizedCustomerPhone } from "./in-task-customer";

// NOV-010: the minimal vendor record a purchasing or transport task needs; the rest is completed
// later in Vendors. Tenant and author are always taken from the session on the server.
export const inTaskVendorSchema = vendorSchema.pick({ vendor_name: true, vendor_type: true, contact_person: true, phone: true, gst_number: true, city: true }).strict()
  .superRefine((value, context) => {
    for (const [field, text] of Object.entries(value)) {
      if (typeof text === "string" && text.length > 160) context.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `${field.replaceAll("_", " ")} is too long for quick vendor entry.` });
    }
  });
export type InTaskVendorInput = z.input<typeof inTaskVendorSchema>;
export type InTaskVendorData = z.output<typeof inTaskVendorSchema>;
export type InTaskVendorOption = { id: string; vendor_name: string; vendor_type: string; phone: string | null; gst_number: string | null; city: string | null; is_active: boolean };
export type InTaskVendorMatch = Pick<InTaskVendorOption, "id" | "vendor_name" | "vendor_type" | "phone" | "gst_number" | "is_active"> & { matched_on: string[] };
export type InTaskVendorResult =
  | { kind: "checked" | "similar"; matches: InTaskVendorMatch[]; hasMore: boolean }
  | { kind: "created" | "selected"; vendor: InTaskVendorOption }
  | { kind: "error"; error: string; uncertain?: boolean };

export const inTaskVendorRequestSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("check"), vendor: inTaskVendorSchema }).strict(),
  z.object({ intent: z.literal("create"), vendor: inTaskVendorSchema, request_id: z.string().uuid(), acknowledge_similar: z.boolean().default(false) }).strict(),
  z.object({ intent: z.literal("select"), vendor_id: z.string().uuid() }).strict()
]);
export type InTaskVendorRequest = z.input<typeof inTaskVendorRequestSchema>;

export const inTaskVendorDefaults: InTaskVendorInput = { vendor_name: "", vendor_type: "other", contact_person: "", phone: "", gst_number: "", city: "" };
export const vendorNamePattern = customerNamePattern;
export const vendorPhonePattern = customerPhonePattern;
export const normalizedVendorPhone = normalizedCustomerPhone;

export function sameVendorRequest(row: Record<string, unknown>, vendor: InTaskVendorData, userId: string) {
  return row.created_by === userId && Object.entries(vendor).every(([field, value]) => (row[field] ?? null) === (value ?? null));
}
export function vendorOption(row: Record<string, any>): InTaskVendorOption {
  return { id: row.id, vendor_name: row.vendor_name, vendor_type: row.vendor_type, phone: row.phone ?? null, gst_number: row.gst_number ?? null, city: row.city ?? null, is_active: row.is_active === true };
}
export function vendorMatchOption(row: Record<string, any>): Omit<InTaskVendorMatch, "matched_on"> {
  return { id: row.id, vendor_name: row.vendor_name, vendor_type: row.vendor_type, phone: row.phone ?? null, gst_number: row.gst_number ?? null, is_active: row.is_active === true };
}
