/**
 * Distributed fixed-window rate limiter backed by Postgres.
 * Development falls back to an in-memory limiter before migrations are applied;
 * production fails closed when the shared limiter is unavailable.
 */

import { createAdminClient } from "@/lib/supabase/admin";

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const store = new Map<string, RateLimitEntry>();

// Cleanup stale entries every 60 seconds to prevent memory leaks
let lastCleanup = Date.now();
function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < 60_000) return;
  lastCleanup = now;
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) store.delete(key);
  }
}

export type RateLimitConfig = {
  /** Maximum requests allowed in the window */
  limit: number;
  /** Window duration in seconds */
  windowSeconds: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  available: boolean;
};

/**
 * Check if a request is within the rate limit.
 * @param identifier - Unique key (e.g., IP address or IP + path)
 * @param config - Rate limit configuration
 */
function checkLocalRateLimit(identifier: string, config: RateLimitConfig): RateLimitResult {
  cleanup();
  const now = Date.now();
  const entry = store.get(identifier);

  if (!entry || entry.resetAt <= now) {
    const resetAt = now + config.windowSeconds * 1000;
    store.set(identifier, { count: 1, resetAt });
    return { allowed: true, remaining: config.limit - 1, resetAt, available: true };
  }

  if (entry.count >= config.limit) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt, available: true };
  }

  entry.count += 1;
  return { allowed: true, remaining: config.limit - entry.count, resetAt: entry.resetAt, available: true };
}

export async function checkRateLimit(identifier: string, config: RateLimitConfig): Promise<RateLimitResult> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("consume_api_rate_limit", {
      p_identifier: identifier,
      p_limit: config.limit,
      p_window_seconds: config.windowSeconds,
    });
    if (error) throw error;
    const result = data as { allowed?: unknown; remaining?: unknown; resetAt?: unknown } | null;
    if (!result || typeof result.allowed !== "boolean" || !Number.isFinite(Number(result.resetAt))) {
      throw new Error("Invalid rate limiter response");
    }
    return {
      allowed: result.allowed,
      remaining: Math.max(0, Number(result.remaining) || 0),
      resetAt: Number(result.resetAt),
      available: true,
    };
  } catch (error) {
    if (process.env.NODE_ENV !== "production") return checkLocalRateLimit(identifier, config);
    console.error("Distributed rate limiter unavailable", error);
    return { allowed: false, remaining: 0, resetAt: Date.now() + 30_000, available: false };
  }
}
