// Server-only: constant-time check of the Authorization header Vercel Cron sends (Bearer CRON_SECRET).
import { timingSafeEqual } from "node:crypto";

export function isAuthorizedCronRequest(header: string | null, secret: string | undefined) {
  if (!secret || secret.length < 16 || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
