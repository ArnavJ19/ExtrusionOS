// AP-038: GSTIN format, state code and check digit. Mirrors private.ap_gstin_valid in the database.
// A GSTIN that passes these checks is well formed; it is not proof that the registration is active.

const CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const FORMAT = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z][0-9A-Z][0-9A-Z]$/;

export const GST_STATES: Record<string, string> = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand", "06": "Haryana", "07": "Delhi",
  "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur", "15": "Mizoram",
  "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal", "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh",
  "24": "Gujarat", "25": "Daman and Diu", "26": "Dadra and Nagar Haveli and Daman and Diu", "27": "Maharashtra", "28": "Andhra Pradesh (before reorganisation)",
  "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry", "35": "Andaman and Nicobar Islands",
  "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh", "97": "Other Territory", "99": "Centre Jurisdiction"
};

export const GSTIN_VALIDITY_NOTE = "Format and check digit verified. This does not confirm that the registration is active on the GST portal.";

export function normalizeGstin(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, "").toUpperCase();
}

/** The fifteenth character for the first fourteen (GSTN mod-36 weighted checksum). */
export function gstinCheckCharacter(first14: string) {
  let sum = 0;
  for (let index = 0; index < 14; index += 1) {
    const value = CHARSET.indexOf(first14[index]) * (index % 2 === 0 ? 1 : 2);
    sum += Math.floor(value / 36) + (value % 36);
  }
  return CHARSET[(36 - (sum % 36)) % 36];
}

export type GstinCheck =
  | { valid: true; gstin: string; stateCode: string; state: string; pan: string }
  | { valid: false; gstin: string; reason: "empty" | "length" | "format" | "state" | "check_digit"; message: string };

export function checkGstin(value: string | null | undefined): GstinCheck {
  const gstin = normalizeGstin(value);
  if (!gstin) return { valid: false, gstin, reason: "empty", message: "Enter the GSTIN or mark the party unregistered." };
  if (gstin.length !== 15) return { valid: false, gstin, reason: "length", message: `A GSTIN has 15 characters; this has ${gstin.length}.` };
  if (!FORMAT.test(gstin)) return { valid: false, gstin, reason: "format", message: "A GSTIN is a 2-digit state code, a 10-character PAN, an entity number, Z (or a letter) and a check character." };
  const stateCode = gstin.slice(0, 2);
  const state = GST_STATES[stateCode];
  if (!state) return { valid: false, gstin, reason: "state", message: `${stateCode} is not a GST state code.` };
  const expected = gstinCheckCharacter(gstin.slice(0, 14));
  if (expected !== gstin[14]) return { valid: false, gstin, reason: "check_digit", message: "The last character does not match the GSTIN check digit. Check the number for a typing error." };
  return { valid: true, gstin, stateCode, state, pan: gstin.slice(2, 12) };
}

export function isValidGstin(value: string | null | undefined) {
  return checkGstin(value).valid;
}

export type GstRegistration = "registered" | "unregistered";

/**
 * Resolves the GST fields a party record should store. An invalid GSTIN is never stored; a party without one must be
 * explicitly unregistered. Returns the state derived from the GSTIN so forms can fill it.
 */
export function resolveGstRegistration(input: { gst_number?: string | null; gst_registration?: string | null }):
  { ok: true; gst_number: string | null; gst_registration: GstRegistration; state: string | null } | { ok: false; field: "gst_number" | "gst_registration"; message: string } {
  const gstin = normalizeGstin(input.gst_number);
  if (input.gst_registration === "unregistered") {
    if (gstin) return { ok: false, field: "gst_number", message: "Clear the GSTIN or untick unregistered." };
    return { ok: true, gst_number: null, gst_registration: "unregistered", state: null };
  }
  const check = checkGstin(gstin);
  if (!check.valid) return { ok: false, field: check.reason === "empty" ? "gst_registration" : "gst_number", message: check.message };
  return { ok: true, gst_number: check.gstin, gst_registration: "registered", state: check.state };
}
