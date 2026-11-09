import { z } from "zod";
import { checkGstin, normalizeGstin } from "./gstin.ts";

export const optionalText = z.string().trim().optional().nullable().transform((value) => value || null);
export const optionalEmail = z.string().trim().optional().nullable().refine((value) => !value || z.string().email().safeParse(value).success, "Enter a valid email").transform((value) => value || null);
export const indianPhone = z.string().trim().optional().nullable().refine((value) => {
  if (!value) return true;
  const digits = value.replace(/\D/g, "");
  const nationalNumber = digits.length === 11 && digits.startsWith("0") ? digits.slice(1) : digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
  return /^[6-9]\d{9}$/.test(nationalNumber);
}, "Enter a valid Indian phone number").transform((value) => value || null);
// AP-038: format, state code and check digit (lib/validations/gstin.ts mirrors the database check).
export const gstNumber = z.string().trim().optional().nullable()
  .refine((value) => !value || checkGstin(value).valid, (value) => ({ message: value ? (checkGstin(value) as { message?: string }).message ?? "Enter a valid GSTIN" : "Enter a valid GSTIN" }))
  .transform((value) => value ? normalizeGstin(value) : null);
/** Registered parties need a valid GSTIN; a party without one is recorded as unregistered by an explicit choice. */
export const gstRegistration = z.union([z.enum(["registered", "unregistered"]), z.literal("")]).optional().nullable().transform((value) => value || null);
/** AP-038: a party record is saved only with a valid GSTIN or an explicit "unregistered" choice. */
export function requireGstChoice(value: { gst_number?: string | null; gst_registration?: string | null }, context: z.RefinementCtx) {
  if (!value.gst_number && value.gst_registration !== "unregistered") context.addIssue({ code: z.ZodIssueCode.custom, path: ["gst_registration"], message: "Enter the GSTIN or mark the party unregistered" });
  if (value.gst_number && value.gst_registration === "unregistered") context.addIssue({ code: z.ZodIssueCode.custom, path: ["gst_number"], message: "An unregistered party has no GSTIN. Clear it or choose registered." });
}
export const numericString = z.coerce.number();
