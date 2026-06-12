import { z } from "zod";

export const optionalText = z.string().trim().optional().nullable().transform((value) => value || null);
export const optionalEmail = z.string().trim().optional().nullable().refine((value) => !value || z.string().email().safeParse(value).success, "Enter a valid email").transform((value) => value || null);
export const indianPhone = z.string().trim().optional().nullable().refine((value) => {
  if (!value) return true;
  const digits = value.replace(/\D/g, "");
  const nationalNumber = digits.length === 11 && digits.startsWith("0") ? digits.slice(1) : digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
  return /^[6-9]\d{9}$/.test(nationalNumber);
}, "Enter a valid Indian phone number").transform((value) => value || null);
export const gstNumber = z.string().trim().optional().nullable().refine((value) => !value || /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}[A-Z\d]{1}[0-9A-Z]{1}$/i.test(value), "Enter a valid GST number").transform((value) => value ? value.toUpperCase() : null);
export const numericString = z.coerce.number();
